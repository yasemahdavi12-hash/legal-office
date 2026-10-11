const db = require('../db/connection');
const config = require('../config');
const { AppError } = require('../utils/response');
const { parseJson, toJson } = require('../utils/dbHelpers');
const { encryptAesGcm, decryptAesGcm } = require('../utils/cryptoBox');
const { BaleService } = require('./messengers/BaleService');
const { RubikaService } = require('./messengers/RubikaService');
const { insertReturningId } = require('../utils/dbHelpers');

const adapters = {
  bale: new BaleService(),
  rubika: new RubikaService()
};

function commEncryptionKey() {
  const key = process.env.MFA_ENCRYPTION_KEY || process.env.BACKUP_ENCRYPTION_KEY || '';
  if (key && String(key).length >= 32) return key;
  return config.jwt.accessSecret;
}

function encryptCommToken(token) {
  return encryptAesGcm(String(token).trim(), commEncryptionKey());
}

function decryptCommToken(tokenEnc) {
  if (!tokenEnc) throw new AppError('توکن پیام‌رسان ذخیره نشده است', 400);
  try {
    return decryptAesGcm(tokenEnc, commEncryptionKey()).toString('utf8');
  } catch {
    throw new AppError('توکن پیام‌رسان قابل خواندن نیست', 500);
  }
}

function sanitizeSettings(settings) {
  const s = settings && typeof settings === 'object' ? { ...settings } : {};
  delete s.token;
  delete s.token_enc;
  return s;
}

function getAdapter(platform) {
  const ad = adapters[platform];
  if (!ad) throw new AppError('پلتفرم نامعتبر است', 400);
  return ad;
}

function mapOut(row) {
  if (!row) return null;
  return {
    id: row.id,
    platform: row.platform,
    channel: row.channel,
    group: row.group_name,
    group_name: row.group_name,
    settings: sanitizeSettings(parseJson(row.settings, {})),
    is_connected: !!row.is_connected,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

async function getOwnerRow(user, platform) {
  return db('communications').where({ owner_id: user.id, platform }).first();
}

async function listCommunications(user) {
  let q = db('communications').select('*');
  if (user.role !== 'admin') q = q.where({ owner_id: user.id });
  const rows = await q;
  return rows.map(mapOut);
}

async function upsertSettings(user, body = {}) {
  const platform = body.platform;
  if (!['bale', 'rubika'].includes(platform)) throw new AppError('پلتفرم نامعتبر است', 400);

  const existing = await db('communications').where({ owner_id: user.id, platform }).first();
  const prev = parseJson(existing?.settings, {});
  const payload = {
    channel: body.channel || null,
    group_name: body.group || body.group_name || null,
    settings: toJson({ ...sanitizeSettings(prev), ...(body.settings || {}) }),
    updated_at: db.fn.now()
  };

  if (existing) {
    await db('communications').where({ id: existing.id }).update(payload);
    return mapOut(await db('communications').where({ id: existing.id }).first());
  }

  const id = await insertReturningId(db, 'communications', {
    owner_id: user.id,
    platform,
    ...payload,
    is_connected: false,
    created_at: db.fn.now()
  });
  return mapOut(await db('communications').where({ id }).first());
}

async function connect(user, body = {}) {
  const platform = body.platform;
  const adapter = getAdapter(platform);
  const token = body.token != null ? String(body.token).trim() : '';

  if (platform === 'bale' && !token) {
    throw new AppError('توکن بله الزامی است', 400);
  }

  const result = await adapter.connect(
    platform === 'bale' ? { token } : (body.settings || { token: body.token })
  );

  const existing = await getOwnerRow(user, platform);
  const prevSettings = parseJson(existing?.settings, {});
  const settings = { ...sanitizeSettings(prevSettings) };
  if (platform === 'bale' && token) {
    settings.token_enc = encryptCommToken(token);
  }

  const data = {
    channel: body.channel || existing?.channel || null,
    group_name: body.group || body.group_name || existing?.group_name || null,
    settings: toJson(settings),
    is_connected: true,
    updated_at: db.fn.now()
  };

  let commId = existing?.id;
  const webhookFields = {};
  if (platform === 'bale') {
    const { generateWebhookSecret } = require('./baleInbound.service');
    webhookFields.inbound_webhook_secret = existing?.inbound_webhook_secret || generateWebhookSecret();
  }

  if (existing) {
    await db('communications').where({ id: existing.id }).update({ ...data, ...webhookFields });
  } else {
    commId = await insertReturningId(db, 'communications', {
      owner_id: user.id,
      platform,
      ...data,
      ...webhookFields,
      created_at: db.fn.now()
    });
  }

  if (platform === 'bale') {
    const { registerBaleWebhookIfConfigured } = require('./baleInbound.service');
    const fresh = await db('communications').where({ id: commId || existing.id }).first();
    await registerBaleWebhookIfConfigured(fresh);
  }

  return { ...result, record: (await listCommunications(user)).find((x) => x.platform === platform) };
}

async function disconnect(user, platform) {
  if (!['bale', 'rubika'].includes(platform)) throw new AppError('پلتفرم نامعتبر است', 400);
  const adapter = getAdapter(platform);
  await adapter.disconnect();

  const existing = await getOwnerRow(user, platform);
  if (platform === 'bale' && existing) {
    const { deleteBaleWebhookIfConnected } = require('./baleInbound.service');
    await deleteBaleWebhookIfConnected(existing);
  }
  const settings = parseJson(existing?.settings, {});
  const nextSettings = { ...sanitizeSettings(settings) };
  if (platform === 'bale') {
    delete nextSettings.token_enc;
    delete nextSettings.bale_update_offset;
  }

  await db('communications')
    .where({ owner_id: user.id, platform })
    .update({
      is_connected: false,
      settings: toJson(nextSettings),
      inbound_webhook_secret: null,
      updated_at: db.fn.now()
    });
  return { platform, connected: false };
}

function resolveChatId(body) {
  const raw = body.chat_id ?? body.chatId ?? body.target;
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  return raw;
}

async function sendMessage(user, body = {}) {
  const platform = body.platform;
  if (platform === 'rubika') {
    return getAdapter(platform).sendMessage(body);
  }
  if (platform !== 'bale') {
    throw new AppError('پلتفرم نامعتبر است', 400);
  }

  const row = await getOwnerRow(user, 'bale');
  if (!row || !row.is_connected) {
    throw new AppError('اتصال بله برقرار نیست. ابتدا توکن را وارد و اتصال را برقرار کنید.', 400);
  }

  const settings = parseJson(row.settings, {});
  const token = decryptCommToken(settings.token_enc);
  const text = String(body.text ?? body.message ?? '').trim();
  const chatId = resolveChatId(body);

  return getAdapter('bale').sendMessage({ token, chatId, text });
}

module.exports = {
  listCommunications,
  upsertSettings,
  connect,
  disconnect,
  sendMessage,
  encryptCommToken,
  decryptCommToken,
  sanitizeSettings
};
