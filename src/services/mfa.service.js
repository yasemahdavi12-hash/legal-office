const db = require('../db/connection');
const config = require('../config');
const { AppError } = require('../utils/response');
const { hashToken, newJti } = require('../utils/jwt');
const { encryptAesGcm, decryptAesGcm } = require('../utils/cryptoBox');
const {
  generateTotpSecret,
  verifyTotp,
  otpauthUrl,
  generateRecoveryCodes,
  totp
} = require('../utils/totp');
const { insertReturningId, toDbDateTime, parseDbDateTime } = require('../utils/dbHelpers');
const { writeAudit } = require('./audit.service');
const { comparePassword } = require('../utils/password');
const jwt = require('jsonwebtoken');

const MFA_MAX_ATTEMPTS = 5;
const MFA_LOCK_MS = 15 * 60 * 1000;
const MFA_CHALLENGE_TTL = '5m';

function mfaKey() {
  const key = process.env.MFA_ENCRYPTION_KEY || process.env.BACKUP_ENCRYPTION_KEY || '';
  if (!key || String(key).length < 32) {
    throw new AppError('کلید رمزنگاری MFA تنظیم نشده است (MFA_ENCRYPTION_KEY)', 503);
  }
  return key;
}

function signMfaChallenge(user) {
  return jwt.sign(
    { id: user.id, typ: 'mfa_challenge', tv: user.token_version || 0 },
    config.jwt.accessSecret,
    { expiresIn: MFA_CHALLENGE_TTL }
  );
}

/** Short-lived token allowing only MFA setup/enable in production bootstrap. */
function signMfaSetupToken(user) {
  return jwt.sign(
    { id: user.id, typ: 'mfa_setup', tv: user.token_version || 0 },
    config.jwt.accessSecret,
    { expiresIn: '15m' }
  );
}

function verifyMfaChallenge(token) {
  const payload = jwt.verify(token, config.jwt.accessSecret);
  if (payload.typ !== 'mfa_challenge') throw new Error('invalid');
  return payload;
}

function encryptSecret(secret) {
  return encryptAesGcm(secret, mfaKey());
}

function decryptSecret(enc) {
  return decryptAesGcm(enc, mfaKey()).toString('utf8');
}

async function assertNotLocked(user) {
  const lockedUntil = parseDbDateTime(user.mfa_locked_until);
  if (lockedUntil && lockedUntil > Date.now()) {
    throw new AppError('تأیید دو مرحله‌ای موقتاً قفل شده است. کمی بعد تلاش کنید.', 429, {
      code: 'MFA_LOCKED'
    });
  }
}

async function recordMfaFailure(userId, ip) {
  const user = await db('users').where({ id: userId }).first();
  const attempts = (user.mfa_failed_attempts || 0) + 1;
  const patch = { mfa_failed_attempts: attempts };
  if (attempts >= MFA_MAX_ATTEMPTS) {
    patch.mfa_locked_until = toDbDateTime(new Date(Date.now() + MFA_LOCK_MS));
    patch.mfa_failed_attempts = 0;
  }
  await db('users').where({ id: userId }).update(patch);
  await writeAudit({
    userId,
    action: 'MFA_FAIL',
    entityType: 'mfa',
    entityId: userId,
    changes: { attempts, locked: !!patch.mfa_locked_until },
    ip
  });
}

async function clearMfaFailures(userId) {
  await db('users').where({ id: userId }).update({
    mfa_failed_attempts: 0,
    mfa_locked_until: null
  });
}

/**
 * Begin MFA setup for admin (authenticated). Returns secret once + recovery codes once.
 */
async function beginSetup(user, meta = {}) {
  if (user.role !== 'admin') throw new AppError('MFA فقط برای مدیر فعال می‌شود', 403);
  const full = await db('users').where({ id: user.id }).first();
  if (full.mfa_enabled) throw new AppError('MFA از قبل فعال است', 400);

  const secret = generateTotpSecret();
  await db('users').where({ id: user.id }).update({
    mfa_secret_enc: encryptSecret(secret),
    mfa_enabled: false
  });

  // Replace recovery codes
  await db('mfa_recovery_codes').where({ user_id: user.id }).del();
  const codes = generateRecoveryCodes(10);
  for (const code of codes) {
    await insertReturningId(db, 'mfa_recovery_codes', {
      user_id: user.id,
      code_hash: hashToken(code),
      used_at: null,
      created_at: db.fn.now()
    });
  }

  await writeAudit({
    userId: user.id,
    action: 'MFA_SETUP',
    entityType: 'mfa',
    entityId: user.id,
    changes: { stage: 'begin' },
    ip: meta.ip
  });

  return {
    secret,
    otpauthUrl: otpauthUrl({
      secret,
      accountName: full.email,
      issuer: 'قانون در جیب شما'
    }),
    recoveryCodes: codes
  };
}

async function enable(user, { code } = {}, meta = {}) {
  if (user.role !== 'admin') throw new AppError('MFA فقط برای مدیر فعال می‌شود', 403);
  const full = await db('users').where({ id: user.id }).first();
  await assertNotLocked(full);
  if (!full.mfa_secret_enc) throw new AppError('ابتدا راه‌اندازی MFA را شروع کنید', 400);
  if (full.mfa_enabled) throw new AppError('MFA از قبل فعال است', 400);

  const secret = decryptSecret(full.mfa_secret_enc);
  if (!verifyTotp(secret, code)) {
    await recordMfaFailure(user.id, meta.ip);
    throw new AppError('کد MFA نامعتبر است', 401);
  }
  await clearMfaFailures(user.id);
  await db('users').where({ id: user.id }).update({ mfa_enabled: true });
  await writeAudit({
    userId: user.id,
    action: 'MFA_ENABLE',
    entityType: 'mfa',
    entityId: user.id,
    changes: { enabled: true },
    ip: meta.ip
  });
  return { ok: true, mfa_enabled: true };
}

async function disable(user, { password, code } = {}, meta = {}) {
  if (user.role !== 'admin') throw new AppError('دسترسی مجاز نیست', 403);
  const full = await db('users').where({ id: user.id }).first();
  if (!full.mfa_enabled) return { ok: true, mfa_enabled: false };
  await assertNotLocked(full);

  const passOk = await comparePassword(password || '', full.password_hash);
  if (!passOk) throw new AppError('رمز عبور نامعتبر است', 401);

  const secret = decryptSecret(full.mfa_secret_enc);
  const totpOk = verifyTotp(secret, code);
  let recoveryOk = false;
  if (!totpOk && code) {
    const row = await db('mfa_recovery_codes')
      .where({ user_id: user.id, code_hash: hashToken(String(code).toLowerCase()), used_at: null })
      .first();
    if (row) {
      recoveryOk = true;
      await db('mfa_recovery_codes').where({ id: row.id }).update({ used_at: db.fn.now() });
    }
  }
  if (!totpOk && !recoveryOk) {
    await recordMfaFailure(user.id, meta.ip);
    throw new AppError('کد MFA نامعتبر است', 401);
  }

  await db('users').where({ id: user.id }).update({
    mfa_enabled: false,
    mfa_secret_enc: null,
    mfa_failed_attempts: 0,
    mfa_locked_until: null
  });
  await db('mfa_recovery_codes').where({ user_id: user.id }).del();
  await writeAudit({
    userId: user.id,
    action: 'MFA_DISABLE',
    entityType: 'mfa',
    entityId: user.id,
    changes: { enabled: false },
    ip: meta.ip
  });
  return { ok: true, mfa_enabled: false };
}

/**
 * Complete login when MFA is required (challenge token + TOTP or recovery code).
 */
async function verifyLoginChallenge({ mfaToken, code }, meta = {}, issueTokensFn) {
  let payload;
  try {
    payload = verifyMfaChallenge(mfaToken);
  } catch {
    throw new AppError('نشست MFA نامعتبر است', 401);
  }
  const user = await db('users').where({ id: payload.id }).first();
  if (!user || !user.mfa_enabled || !user.mfa_secret_enc) {
    throw new AppError('نشست MFA نامعتبر است', 401);
  }
  if ((user.token_version || 0) !== (payload.tv || 0)) {
    throw new AppError('نشست MFA نامعتبر است', 401);
  }
  await assertNotLocked(user);

  const secret = decryptSecret(user.mfa_secret_enc);
  let ok = verifyTotp(secret, code);
  let usedRecovery = false;
  if (!ok && code) {
    const row = await db('mfa_recovery_codes')
      .where({ user_id: user.id, code_hash: hashToken(String(code).toLowerCase()), used_at: null })
      .first();
    if (row) {
      ok = true;
      usedRecovery = true;
      await db('mfa_recovery_codes').where({ id: row.id }).update({ used_at: db.fn.now() });
    }
  }

  if (!ok) {
    await recordMfaFailure(user.id, meta.ip);
    throw new AppError('کد MFA نامعتبر است', 401);
  }

  await clearMfaFailures(user.id);
  await writeAudit({
    userId: user.id,
    action: usedRecovery ? 'MFA_RECOVERY' : 'MFA_OK',
    entityType: 'mfa',
    entityId: user.id,
    changes: { login: true },
    ip: meta.ip
  });
  return issueTokensFn(user, meta);
}

function statusForUser(userRow) {
  const lockedUntil = parseDbDateTime(userRow.mfa_locked_until);
  return {
    mfa_enabled: !!userRow.mfa_enabled,
    mfa_locked: !!(lockedUntil && lockedUntil > Date.now())
  };
}

/** Dev/test helper — never log secret */
function _totpNowForTests(secret) {
  return totp(secret);
}

module.exports = {
  beginSetup,
  enable,
  disable,
  verifyLoginChallenge,
  signMfaChallenge,
  signMfaSetupToken,
  statusForUser,
  _totpNowForTests
};
