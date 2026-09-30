const { verifyAccessToken } = require('../utils/jwt');
const db = require('../db/connection');
const { AppError } = require('../utils/response');
const config = require('../config');

async function isFamilyRevoked(familyId) {
  if (!familyId) return false;
  const row = await db('revoked_token_families').where({ family_id: familyId }).first();
  return !!row;
}

async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new AppError('لطفاً وارد شوید', 401);

    const payload = verifyAccessToken(token);
    if (payload.fid && await isFamilyRevoked(payload.fid)) {
      throw new AppError('توکن نامعتبر است', 401);
    }

    const user = await db('users').where({ id: payload.id }).first();
    if (!user) throw new AppError('کاربر یافت نشد', 401);
    if ((user.token_version || 0) !== (payload.tv || 0)) {
      throw new AppError('توکن نامعتبر است', 401);
    }

    // Production: admin without MFA cannot use normal APIs (MFA routes use authenticateMfaAdmin)
    if (config.isProd && user.role === 'admin' && !user.mfa_enabled) {
      throw new AppError('فعال‌سازی MFA برای مدیر الزامی است', 403, { code: 'MFA_SETUP_REQUIRED' });
    }

    req.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      phone: user.phone,
      token_version: user.token_version,
      mfa_enabled: !!user.mfa_enabled,
      family_id: payload.fid || null
    };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return next(new AppError('توکن منقضی شده است', 401));
    }
    if (err.name === 'JsonWebTokenError') {
      return next(new AppError('توکن نامعتبر است', 401));
    }
    next(err.status ? err : new AppError('توکن نامعتبر است', 401));
  }
}

/**
 * Accept full admin access token OR short-lived MFA setup token (prod bootstrap).
 */
async function authenticateMfaAdmin(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new AppError('لطفاً وارد شوید', 401);

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch {
      const jwt = require('jsonwebtoken');
      payload = jwt.verify(token, require('../config').jwt.accessSecret);
      if (payload.typ !== 'mfa_setup') throw new AppError('توکن نامعتبر است', 401);
    }

    if (payload.typ === 'access' && payload.fid && await isFamilyRevoked(payload.fid)) {
      throw new AppError('توکن نامعتبر است', 401);
    }

    const user = await db('users').where({ id: payload.id }).first();
    if (!user || user.role !== 'admin') throw new AppError('دسترسی مجاز نیست', 403);
    if ((user.token_version || 0) !== (payload.tv || 0)) {
      throw new AppError('توکن نامعتبر است', 401);
    }

    req.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      phone: user.phone,
      token_version: user.token_version,
      mfa_enabled: !!user.mfa_enabled,
      mfa_setup_only: payload.typ === 'mfa_setup'
    };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return next(new AppError('توکن منقضی شده است', 401));
    }
    next(err.status ? err : new AppError('توکن نامعتبر است', 401));
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(new AppError('لطفاً وارد شوید', 401));
    if (!roles.includes(req.user.role)) {
      return next(new AppError('دسترسی مجاز نیست', 403));
    }
    next();
  };
}

module.exports = { authenticate, authenticateMfaAdmin, requireRole, isFamilyRevoked };
