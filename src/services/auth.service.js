const db = require('../db/connection');
const { AppError } = require('../utils/response');
const { hashPassword, comparePassword } = require('../utils/password');
const {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashToken,
  newJti
} = require('../utils/jwt');
const { mapUserOut } = require('../utils/mappers');
const { writeAudit } = require('./audit.service');
const { insertReturningId, toDbDateTime, parseDbDateTime } = require('../utils/dbHelpers');
const config = require('../config');
const mfaService = require('./mfa.service');
const { adminLoginGate } = require('./auth.gates');

const AUTH_FAIL_MESSAGE = 'ایمیل یا رمز عبور اشتباه است';
const { normalizePhone } = require('../utils/phone');

function parseExpiryToDate(expiresIn) {
  const m = String(expiresIn).match(/^(\d+)([smhd])$/i);
  const now = Date.now();
  if (!m) return new Date(now + 30 * 24 * 3600 * 1000);
  const n = Number(m[1]);
  const u = m[2].toLowerCase();
  const ms = u === 's' ? n * 1000 : u === 'm' ? n * 60 * 1000 : u === 'h' ? n * 3600 * 1000 : n * 86400 * 1000;
  return new Date(now + ms);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Revoke refresh tokens in family AND mark family so access tokens with fid are rejected.
 * Does not bump user.token_version — other session families stay valid.
 */
async function revokeFamily(familyId, userId) {
  if (!familyId) return;
  await db('refresh_tokens')
    .where({ family_id: familyId })
    .whereNull('revoked_at')
    .update({ revoked_at: db.fn.now() });

  const existing = await db('revoked_token_families').where({ family_id: familyId }).first();
  if (!existing) {
    await db('revoked_token_families').insert({
      family_id: familyId,
      user_id: userId || null,
      revoked_at: db.fn.now()
    });
  }
}

async function issueTokens(user, meta = {}, { familyId } = {}) {
  const jti = newJti();
  const family = familyId || newJti();
  const accessToken = signAccessToken(user, { familyId: family });
  const refreshToken = signRefreshToken(user, jti, { familyId: family });
  const expiresAt = parseExpiryToDate(config.jwt.refreshExpires);

  await db('refresh_tokens').insert({
    user_id: user.id,
    token_hash: hashToken(refreshToken),
    family_id: family,
    expires_at: toDbDateTime(expiresAt),
    user_agent: meta.userAgent || null,
    ip: meta.ip || null,
    created_at: db.fn.now()
  });

  return {
    token: accessToken,
    accessToken,
    refreshToken,
    expiresIn: config.jwt.accessExpires,
    user: mapUserOut(user)
  };
}

async function register({ name, email, password, phone }, meta = {}) {
  if (!password || String(password).length < 8) {
    throw new AppError('رمز عبور باید حداقل ۸ کاراکتر باشد', 400);
  }

  const exists = await db('users').where({ email }).first();
  if (exists) {
    throw new AppError('امکان ثبت‌نام با این اطلاعات وجود ندارد', 400);
  }

  const safeRole = 'lawyer';
  const id = await insertReturningId(db, 'users', {
    name,
    email,
    phone: phone || null,
    password_hash: await hashPassword(password),
    role: safeRole,
    token_version: 0,
    must_change_password: false,
    created_at: db.fn.now()
  });

  const user = await db('users').where({ id }).first();
  await writeAudit({
    userId: user.id,
    action: 'CREATE',
    entityType: 'user',
    entityId: user.id,
    changes: { email, role: safeRole, name },
    ip: meta.ip
  });

  return issueTokens(user, meta);
}

async function login({ email, password }, meta = {}) {
  const started = Date.now();
  const user = await db('users').where({ email }).first();
  let ok = false;
  if (user) {
    ok = await comparePassword(password, user.password_hash);
  } else {
    await comparePassword(password || 'invalid', '$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWX12');
  }

  const elapsed = Date.now() - started;
  if (elapsed < 120) await delay(120 - elapsed);

  if (!ok) {
    await writeAudit({
      userId: user ? user.id : null,
      action: 'LOGIN_FAIL',
      entityType: 'auth',
      entityId: user ? user.id : null,
      changes: { email: email || null },
      ip: meta.ip
    });
    throw new AppError(AUTH_FAIL_MESSAGE, 401);
  }

  // Production: admin must complete MFA; if not enabled yet, only setup token
  const gate = adminLoginGate(user, {
    isProd: config.isProd,
    signMfaSetupToken: mfaService.signMfaSetupToken,
    signMfaChallenge: mfaService.signMfaChallenge
  });
  if (gate) {
    await writeAudit({
      userId: user.id,
      action: gate.mfaSetupRequired ? 'LOGIN_MFA_SETUP_REQUIRED' : 'LOGIN_MFA_REQUIRED',
      entityType: 'auth',
      entityId: user.id,
      changes: {},
      ip: meta.ip
    });
    return gate;
  }

  await writeAudit({
    userId: user.id,
    action: 'LOGIN_OK',
    entityType: 'auth',
    entityId: user.id,
    changes: { role: user.role },
    ip: meta.ip
  });
  return issueTokens(user, meta);
}

/** Client portal registration — role is always client; ignores role in body. */
async function registerClient({ name, email, password, phone }, meta = {}) {
  if (!password || String(password).length < 8) {
    throw new AppError('رمز عبور باید حداقل ۸ کاراکتر باشد', 400);
  }
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone || normalizedPhone.length < 10) {
    throw new AppError('شماره موبایل معتبر برای اتصال به دعوت الزامی است', 400);
  }

  const exists = await db('users').where({ email }).first();
  if (exists) {
    throw new AppError('امکان ثبت‌نام با این اطلاعات وجود ندارد', 400);
  }

  const id = await insertReturningId(db, 'users', {
    name,
    email,
    phone: normalizedPhone,
    password_hash: await hashPassword(password),
    role: 'client',
    token_version: 0,
    must_change_password: false,
    created_at: db.fn.now()
  });

  const user = await db('users').where({ id }).first();
  await writeAudit({
    userId: user.id,
    action: 'CREATE',
    entityType: 'user',
    entityId: user.id,
    changes: { email, role: 'client', name },
    ip: meta.ip
  });

  return issueTokens(user, meta);
}

async function refresh(refreshToken, meta = {}) {
  if (!refreshToken) throw new AppError('نشست نامعتبر است', 401);

  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw new AppError('نشست نامعتبر است', 401);
  }

  const tokenHash = hashToken(refreshToken);
  const stored = await db('refresh_tokens').where({ token_hash: tokenHash }).first();

  if (stored && stored.revoked_at) {
    await revokeFamily(stored.family_id, stored.user_id);
    await writeAudit({
      userId: stored.user_id,
      action: 'REFRESH_REUSE',
      entityType: 'auth',
      entityId: stored.user_id,
      changes: { family_id: stored.family_id, token_id: stored.id },
      ip: meta.ip
    });
    throw new AppError('نشست نامعتبر است', 401);
  }

  if (!stored) throw new AppError('نشست نامعتبر است', 401);
  if ((parseDbDateTime(stored.expires_at) || 0) < Date.now()) {
    throw new AppError('نشست نامعتبر است', 401);
  }

  if (stored.family_id) {
    const revoked = await db('revoked_token_families').where({ family_id: stored.family_id }).first();
    if (revoked) throw new AppError('نشست نامعتبر است', 401);
  }

  const user = await db('users').where({ id: payload.id }).first();
  if (!user || (user.token_version || 0) !== (payload.tv || 0)) {
    throw new AppError('نشست نامعتبر است', 401);
  }

  await db('refresh_tokens').where({ id: stored.id }).update({ revoked_at: db.fn.now() });
  return issueTokens(user, meta, { familyId: stored.family_id || newJti() });
}

async function logout(refreshToken, userId) {
  let uid = userId || null;

  if (refreshToken) {
    const tokenHash = hashToken(refreshToken);
    const stored = await db('refresh_tokens').where({ token_hash: tokenHash }).first();
    if (stored) {
      uid = stored.user_id;
      await revokeFamily(stored.family_id, stored.user_id);
      await db('refresh_tokens').where({ id: stored.id }).update({ revoked_at: db.fn.now() });
    }
  }

  if (uid) {
    await db('refresh_tokens')
      .where({ user_id: uid, revoked_at: null })
      .update({ revoked_at: db.fn.now() });
    await db('users').where({ id: uid }).increment('token_version', 1);
  }

  return { ok: true };
}

async function getProfile(userId) {
  const user = await db('users').where({ id: userId }).first();
  if (!user) throw new AppError('کاربر یافت نشد', 404);
  return mapUserOut(user);
}

/** Minimal profile update — name/phone/license only (no email change without verification). */
async function updateProfile(userId, body = {}, meta = {}) {
  const user = await db('users').where({ id: userId }).first();
  if (!user) throw new AppError('کاربر یافت نشد', 404);

  const patch = {};
  if (body.name !== undefined) {
    const name = String(body.name || '').trim();
    if (name.length < 2) throw new AppError('نام باید حداقل ۲ کاراکتر باشد', 400);
    if (name.length > 120) throw new AppError('نام بیش از حد طولانی است', 400);
    patch.name = name;
  }
  if (body.phone !== undefined) {
    const phone = body.phone == null || body.phone === '' ? null : String(body.phone).trim().slice(0, 32);
    patch.phone = phone;
  }
  if (body.license_number !== undefined || body.licenseNumber !== undefined) {
    const raw = body.license_number !== undefined ? body.license_number : body.licenseNumber;
    const license = raw == null || raw === '' ? null : String(raw).trim().slice(0, 64);
    patch.license_number = license;
  }
  if (!Object.keys(patch).length) {
    return mapUserOut(user);
  }

  await db('users').where({ id: userId }).update(patch);
  const updated = await db('users').where({ id: userId }).first();
  await writeAudit({
    userId,
    action: 'PROFILE_UPDATE',
    entityType: 'user',
    entityId: userId,
    changes: { fields: Object.keys(patch) },
    ip: meta.ip
  });
  return mapUserOut(updated);
}

async function changePassword(userId, body = {}, meta = {}) {
  const currentPassword = body.currentPassword || body.current_password || body.oldPassword || '';
  const newPassword = body.newPassword || body.new_password || body.password || '';
  if (!currentPassword) throw new AppError('رمز فعلی الزامی است', 400);
  if (!newPassword || String(newPassword).length < 8) {
    throw new AppError('رمز عبور جدید باید حداقل ۸ کاراکتر باشد', 400);
  }

  const user = await db('users').where({ id: userId }).first();
  if (!user) throw new AppError('کاربر یافت نشد', 404);

  const ok = await comparePassword(String(currentPassword), user.password_hash);
  if (!ok) throw new AppError('رمز فعلی نادرست است', 401);

  await db('users').where({ id: userId }).update({
    password_hash: await hashPassword(String(newPassword)),
    must_change_password: false
  });

  await writeAudit({
    userId,
    action: 'PASSWORD_CHANGE',
    entityType: 'auth',
    entityId: userId,
    changes: {},
    ip: meta.ip
  });

  return { ok: true };
}

module.exports = {
  register,
  registerClient,
  login,
  refresh,
  logout,
  issueTokens,
  revokeFamily,
  getProfile,
  updateProfile,
  changePassword
};
