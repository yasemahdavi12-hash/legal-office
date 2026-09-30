const db = require('../db/connection');
const { AppError } = require('../utils/response');
const { parseJson, toJson } = require('../utils/dbHelpers');
const { BaleService } = require('./messengers/BaleService');
const { RubikaService } = require('./messengers/RubikaService');
const { insertReturningId } = require('../utils/dbHelpers');

const adapters = {
  bale: new BaleService(),
  rubika: new RubikaService()
};

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
    settings: parseJson(row.settings, {}),
    is_connected: !!row.is_connected,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
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

  const payload = {
    channel: body.channel || null,
    group_name: body.group || body.group_name || null,
    settings: toJson(body.settings || {}),
    updated_at: db.fn.now()
  };

  const existing = await db('communications').where({ owner_id: user.id, platform }).first();
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
  const result = await adapter.connect(body.settings || { token: body.token });

  const existing = await db('communications').where({ owner_id: user.id, platform }).first();
  const data = {
    channel: body.channel || existing?.channel || null,
    group_name: body.group || body.group_name || existing?.group_name || null,
    settings: toJson(body.settings || parseJson(existing?.settings, {})),
    is_connected: true,
    updated_at: db.fn.now()
  };

  if (existing) {
    await db('communications').where({ id: existing.id }).update(data);
  } else {
    await db('communications').insert({
      owner_id: user.id,
      platform,
      ...data,
      created_at: db.fn.now()
    });
  }

  return { ...result, record: (await listCommunications(user)).find(x => x.platform === platform) };
}

async function disconnect(user, platform) {
  const adapter = getAdapter(platform);
  await adapter.disconnect();
  await db('communications')
    .where({ owner_id: user.id, platform })
    .update({ is_connected: false, updated_at: db.fn.now() });
  return { platform, connected: false };
}

async function sendMessage(user, body = {}) {
  const adapter = getAdapter(body.platform);
  // Interface only — will throw 501 until real integration
  return adapter.sendMessage(body);
}

module.exports = {
  listCommunications,
  upsertSettings,
  connect,
  disconnect,
  sendMessage
};
