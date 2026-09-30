const crypto = require('crypto');
const db = require('../db/connection');
const config = require('../config');
const { AppError } = require('../utils/response');
const { hashPassword } = require('../utils/password');
const { hashToken, newJti } = require('../utils/jwt');
const { insertReturningId, toDbDateTime, parseDbDateTime } = require('../utils/dbHelpers');
const { getSmsProvider, isSmsDeliveryConfigured } = require('./sms');
const { writeAudit } = require('./audit.service');

const OTP_TTL_MS = 5 * 60 * 1000;
const RESET_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const GENERIC_FORGOT_MSG = 'اگر حسابی با این مشخصات وجود داشته باشد، کد تأیید ارسال شد.';
const GENERIC_VERIFY_FAIL = 'کد تأیید نامعتبر است.';

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeIdentifier(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  if (value.includes('@')) {
    return { type: 'email', norm: value.toLowerCase() };
  }
  const digits = value.replace(/\D/g, '');
  if (digits.length >= 10 && digits.length <= 15) {
    return { type: 'phone', norm: digits };
  }
  return null;
}

function generateOtp() {
  // Non-production test hook only — never used in production
  if (!config.isProd && process.env.OTP_TEST_FIXED && /^\d{6}$/.test(process.env.OTP_TEST_FIXED)) {
    return process.env.OTP_TEST_FIXED;
  }
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function hashOtp(otp, salt) {
  return crypto
    .createHash('sha256')
    .update(`${String(otp)}:${salt}:${config.jwt.accessSecret}`)
    .digest('hex');
}

async function findUserByIdentifier(ident) {
  if (ident.type === 'email') {
    return db('users').where({ email: ident.norm }).first();
  }
  let user = await db('users').where({ phone: ident.norm }).first();
  if (!user && ident.norm.length >= 10) {
    user = await db('users').where('phone', 'like', '%' + ident.norm.slice(-10)).first();
  }
  return user;
}

async function forgotPassword(body = {}, meta = {}) {
  const started = Date.now();
  const raw = body.identifier || body.email || body.phone;
  const ident = normalizeIdentifier(raw);

  // Always spend similar time even on invalid identifier
  if (!ident) {
    const elapsed = Date.now() - started;
    if (elapsed < 120) await delay(120 - elapsed);
    return { ok: true, message: GENERIC_FORGOT_MSG };
  }

  const user = await findUserByIdentifier(ident);
  if (user) {
    if (config.isProd && !isSmsDeliveryConfigured()) {
      throw new AppError('ارسال پیامک در حال حاضر فعال نیست.', 503, { code: 'SMS_NOT_CONFIGURED' });
    }
    // Invalidate previous active OTPs for this identifier
    await db('password_otps')
      .where({ identifier_norm: ident.norm, consumed_at: null })
      .update({ consumed_at: db.fn.now() });

    const otp = generateOtp();
    const salt = newJti();
    const expiresAt = toDbDateTime(new Date(Date.now() + OTP_TTL_MS));

    await insertReturningId(db, 'password_otps', {
      user_id: user.id,
      identifier_type: ident.type,
      identifier_norm: ident.norm,
      otp_salt: salt,
      otp_hash: hashOtp(otp, salt),
      attempts: 0,
      max_attempts: MAX_ATTEMPTS,
      expires_at: expiresAt,
      consumed_at: null,
      ip: meta.ip || null,
      created_at: db.fn.now()
    });

    // Delivery abstraction (Null provider queues nothing / no network).
    // Providers must never log `code`.
    await getSmsProvider().sendOtp({
      to: ident.norm,
      template: 'password_reset_otp',
      code: otp,
      meta: { purpose: 'password_reset', ttlMinutes: 5, channel: ident.type }
    });
    await writeAudit({
      userId: user.id,
      action: 'PASSWORD_RESET_REQUEST',
      entityType: 'auth',
      entityId: user.id,
      changes: { identifier_type: ident.type },
      ip: meta.ip
    });
  } else {
    // Mimic provider work for missing users (timing / side-channel parity)
    await getSmsProvider().sendOtp({
      to: ident.norm,
      template: 'password_reset_otp',
      code: '000000',
      meta: { purpose: 'password_reset', ttlMinutes: 5, channel: ident.type }
    });
  }

  const elapsed = Date.now() - started;
  if (elapsed < 120) await delay(120 - elapsed);
  return { ok: true, message: GENERIC_FORGOT_MSG };
}

async function verifyOtp(body = {}, meta = {}) {
  const started = Date.now();
  const raw = body.identifier || body.email || body.phone;
  const otp = String(body.otp || body.code || '').trim();
  const ident = normalizeIdentifier(raw);

  if (!ident || !/^\d{6}$/.test(otp)) {
    const elapsed = Date.now() - started;
    if (elapsed < 100) await delay(100 - elapsed);
    throw new AppError(GENERIC_VERIFY_FAIL, 400);
  }

  const row = await db('password_otps')
    .where({ identifier_norm: ident.norm, consumed_at: null })
    .orderBy('id', 'desc')
    .first();

  if (!row) {
    const elapsed = Date.now() - started;
    if (elapsed < 100) await delay(100 - elapsed);
    throw new AppError(GENERIC_VERIFY_FAIL, 400);
  }

  if ((parseDbDateTime(row.expires_at) || 0) < Date.now()) {
    await db('password_otps').where({ id: row.id }).update({ consumed_at: db.fn.now() });
    throw new AppError(GENERIC_VERIFY_FAIL, 400);
  }

  if (row.attempts >= row.max_attempts) {
    await db('password_otps').where({ id: row.id }).update({ consumed_at: db.fn.now() });
    throw new AppError(GENERIC_VERIFY_FAIL, 400);
  }

  const ok = hashOtp(otp, row.otp_salt) === row.otp_hash;
  if (!ok) {
    await db('password_otps').where({ id: row.id }).update({ attempts: row.attempts + 1 });
    if (row.attempts + 1 >= row.max_attempts) {
      await db('password_otps').where({ id: row.id }).update({ consumed_at: db.fn.now() });
    }
    const elapsed = Date.now() - started;
    if (elapsed < 100) await delay(100 - elapsed);
    throw new AppError(GENERIC_VERIFY_FAIL, 400);
  }

  // One-time OTP
  await db('password_otps').where({ id: row.id }).update({ consumed_at: db.fn.now() });

  const resetToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = toDbDateTime(new Date(Date.now() + RESET_TTL_MS));
  await insertReturningId(db, 'password_reset_sessions', {
    user_id: row.user_id,
    otp_id: row.id,
    token_hash: hashToken(resetToken),
    expires_at: expiresAt,
    consumed_at: null,
    ip: meta.ip || null,
    created_at: db.fn.now()
  });

  await writeAudit({
    userId: row.user_id,
    action: 'PASSWORD_RESET_OTP_OK',
    entityType: 'auth',
    entityId: row.user_id,
    changes: {},
    ip: meta.ip
  });

  const elapsed = Date.now() - started;
  if (elapsed < 100) await delay(100 - elapsed);

  return {
    ok: true,
    resetToken,
    expiresIn: '10m'
  };
}

async function resetPassword(body = {}, meta = {}) {
  const resetToken = body.resetToken || body.reset_token;
  const password = body.password || body.newPassword || body.new_password;

  if (!resetToken || typeof resetToken !== 'string') {
    throw new AppError('نشست بازیابی نامعتبر است', 400);
  }
  if (!password || String(password).length < 8) {
    throw new AppError('رمز عبور باید حداقل ۸ کاراکتر باشد', 400);
  }

  const tokenHash = hashToken(resetToken);
  const session = await db('password_reset_sessions').where({ token_hash: tokenHash }).first();
  if (!session || session.consumed_at) {
    throw new AppError('نشست بازیابی نامعتبر است', 400);
  }
  if ((parseDbDateTime(session.expires_at) || 0) < Date.now()) {
    await db('password_reset_sessions').where({ id: session.id }).update({ consumed_at: db.fn.now() });
    throw new AppError('نشست بازیابی نامعتبر است', 400);
  }

  const user = await db('users').where({ id: session.user_id }).first();
  if (!user) throw new AppError('نشست بازیابی نامعتبر است', 400);

  await db.transaction(async (trx) => {
    await trx('users').where({ id: user.id }).update({
      password_hash: await hashPassword(password),
      token_version: (user.token_version || 0) + 1,
      must_change_password: false
    });

    await trx('refresh_tokens')
      .where({ user_id: user.id, revoked_at: null })
      .update({ revoked_at: trx.fn.now() });

    await trx('password_reset_sessions')
      .where({ id: session.id })
      .update({ consumed_at: trx.fn.now() });

    // Invalidate any other open reset sessions for this user
    await trx('password_reset_sessions')
      .where({ user_id: user.id, consumed_at: null })
      .whereNot({ id: session.id })
      .update({ consumed_at: trx.fn.now() });
  });

  await writeAudit({
    userId: user.id,
    action: 'PASSWORD_RESET_OK',
    entityType: 'auth',
    entityId: user.id,
    changes: {},
    ip: meta.ip
  });

  return {
    ok: true,
    message: 'رمز عبور با موفقیت تغییر کرد. لطفاً دوباره وارد شوید.'
  };
}

module.exports = {
  forgotPassword,
  verifyOtp,
  resetPassword,
  // exported for unit tests only
  _internal: { normalizeIdentifier, hashOtp, generateOtp }
};
