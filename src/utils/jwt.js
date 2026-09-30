const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('../config');

function signAccessToken(user, { familyId } = {}) {
  const payload = {
    id: user.id,
    role: user.role,
    name: user.name,
    tv: user.token_version || 0,
    typ: 'access'
  };
  if (familyId) payload.fid = familyId;
  return jwt.sign(payload, config.jwt.accessSecret, { expiresIn: config.jwt.accessExpires });
}

function verifyAccessToken(token) {
  const payload = jwt.verify(token, config.jwt.accessSecret);
  if (payload.typ && payload.typ !== 'access') throw new Error('invalid token type');
  return payload;
}

function signRefreshToken(user, jti, { familyId } = {}) {
  const payload = {
    id: user.id,
    tv: user.token_version || 0,
    jti,
    typ: 'refresh'
  };
  if (familyId) payload.fid = familyId;
  return jwt.sign(payload, config.jwt.refreshSecret, { expiresIn: config.jwt.refreshExpires });
}

function verifyRefreshToken(token) {
  const payload = jwt.verify(token, config.jwt.refreshSecret);
  if (payload.typ !== 'refresh') throw new Error('invalid token type');
  return payload;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function newJti() {
  return crypto.randomBytes(16).toString('hex');
}

module.exports = {
  signAccessToken,
  verifyAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashToken,
  newJti
};
