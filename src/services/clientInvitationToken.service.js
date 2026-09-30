const crypto = require('crypto');
const db = require('../db/connection');
const config = require('../config');
const { insertReturningId, toDbDateTime, parseDbDateTime } = require('../utils/dbHelpers');
const { AppError } = require('../utils/response');

const TOKEN_BYTES = 32;

function hashInvitationToken(raw) {
  return crypto.createHash('sha256').update(String(raw), 'utf8').digest('hex');
}

function generateRawInvitationToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

function buildInvitationUrl(rawToken) {
  const base = (config.publicAppUrl || '').replace(/\/$/, '');
  return `${base}/portal/invite/${encodeURIComponent(rawToken)}`;
}

function ttlDays() {
  const d = Number(config.invitation.tokenTtlDays || 7);
  return Number.isFinite(d) && d > 0 ? d : 7;
}

async function invalidateTokensForAccess(accessId, trx = db) {
  const now = trx.fn.now();
  await trx('client_invitation_tokens')
    .where({ access_id: accessId })
    .whereNull('used_at')
    .update({ used_at: now });
}

/**
 * Create a new invitation token for pending access; invalidates previous unused tokens.
 * @returns {{ rawToken: string, invitationUrl: string, expiresAt: Date }}
 */
async function createInvitationTokenForAccess(accessId, trx = db) {
  await invalidateTokensForAccess(accessId, trx);
  const rawToken = generateRawInvitationToken();
  const tokenHash = hashInvitationToken(rawToken);
  const expiresAt = new Date(Date.now() + ttlDays() * 24 * 60 * 60 * 1000);
  const now = trx.fn.now();
  await insertReturningId(trx, 'client_invitation_tokens', {
    access_id: accessId,
    token_hash: tokenHash,
    expires_at: toDbDateTime(expiresAt),
    used_at: null,
    created_at: now
  });
  return {
    rawToken,
    invitationUrl: buildInvitationUrl(rawToken),
    expiresAt
  };
}

async function findTokenRowByRaw(rawToken) {
  if (!rawToken || typeof rawToken !== 'string' || rawToken.length > 128) return null;
  const hash = hashInvitationToken(rawToken.trim());
  return db('client_invitation_tokens as t')
    .join('case_client_access as a', 'a.id', 't.access_id')
    .where('t.token_hash', hash)
    .select(
      't.id as token_id',
      't.access_id',
      't.expires_at',
      't.used_at',
      'a.status as access_status',
      'a.case_id',
      'a.client_id'
    )
    .first();
}

const PUBLIC_MESSAGES = {
  invalid: 'لینک دعوت نامعتبر است.',
  expired: 'اعتبار این لینک دعوت به پایان رسیده است.',
  revoked: 'این دعوت لغو شده است.',
  used: 'این لینک دعوت قبلاً استفاده شده است.',
  valid: 'برای ادامه، وارد حساب موکل شوید یا حساب موکل ایجاد کنید.'
};

/**
 * Public invite status — no case/client sensitive fields.
 */
async function getPublicInviteStatus(rawToken) {
  const row = await findTokenRowByRaw(rawToken);
  if (!row) {
    return { status: 'invalid', message: PUBLIC_MESSAGES.invalid };
  }
  if (row.access_status === 'revoked') {
    return { status: 'revoked', message: PUBLIC_MESSAGES.revoked };
  }
  if (row.access_status === 'active') {
    return { status: 'used', message: PUBLIC_MESSAGES.used };
  }
  if (row.used_at) {
    return { status: 'used', message: PUBLIC_MESSAGES.used };
  }
  const expMs = parseDbDateTime(row.expires_at);
  if (expMs != null && expMs < Date.now()) {
    return { status: 'expired', message: PUBLIC_MESSAGES.expired };
  }
  if (row.access_status !== 'pending') {
    return { status: 'invalid', message: PUBLIC_MESSAGES.invalid };
  }
  return { status: 'valid', message: PUBLIC_MESSAGES.valid };
}

async function assertTokenAcceptable(rawToken) {
  const status = await getPublicInviteStatus(rawToken);
  if (status.status !== 'valid') {
    const code = status.status === 'expired' ? 410 : status.status === 'revoked' ? 403 : 404;
    throw new AppError(status.message, code, { code: `INVITE_${status.status.toUpperCase()}` });
  }
  const row = await findTokenRowByRaw(rawToken);
  if (!row) throw new AppError(PUBLIC_MESSAGES.invalid, 404);
  return row;
}

async function markTokenUsed(tokenId, trx = db) {
  const usedAt = toDbDateTime(new Date());
  await trx('client_invitation_tokens')
    .where({ id: tokenId })
    .whereNull('used_at')
    .update({ used_at: usedAt });
}

module.exports = {
  hashInvitationToken,
  generateRawInvitationToken,
  buildInvitationUrl,
  createInvitationTokenForAccess,
  invalidateTokensForAccess,
  getPublicInviteStatus,
  assertTokenAcceptable,
  markTokenUsed,
  findTokenRowByRaw,
  PUBLIC_MESSAGES
};
