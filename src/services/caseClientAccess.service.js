const db = require('../db/connection');
const config = require('../config');
const { AppError } = require('../utils/response');
const { assertCaseAccess } = require('./case.service');
const { getClient } = require('./client.service');
const { insertReturningId, toDbDateTime } = require('../utils/dbHelpers');
const { phonesMatch } = require('../utils/phone');
const tokenService = require('./clientInvitationToken.service');
const { sendClientInvitation } = require('./clientInvitationNotification.service');

const STATUSES = {
  PENDING: 'pending',
  ACTIVE: 'active',
  REVOKED: 'revoked'
};

function mapAccessOut(row, client) {
  if (!row) return null;
  return {
    id: row.id,
    caseId: row.case_id,
    clientId: row.client_id,
    status: row.status,
    invitedAt: row.invited_at,
    acceptedAt: row.accepted_at || null,
    client: client
      ? {
          id: client.id,
          name: client.name,
          phone: client.phone || null
        }
      : undefined
  };
}

async function getAccessRowForCase(accessId, caseId) {
  const row = await db('case_client_access').where({ id: accessId, case_id: caseId }).first();
  if (!row) throw new AppError('دسترسی یافت نشد', 404);
  return row;
}

/**
 * Lawyer: invite existing client to owned case (pending only in DB).
 */
async function inviteClientToCase(caseId, clientId, user) {
  await assertCaseAccess(caseId, user);
  const client = await getClient(clientId, user);

  const existing = await db('case_client_access')
    .where({ case_id: caseId, client_id: clientId })
    .first();

  if (existing && existing.status === STATUSES.ACTIVE) {
    throw new AppError('این موکل قبلاً دسترسی فعال به پرونده دارد.', 409, {
      code: 'ACCESS_ALREADY_ACTIVE',
      accessId: existing.id
    });
  }

  if (existing && existing.status === STATUSES.PENDING) {
    const inviteMeta = await issueInvitationForAccess(existing, client, user);
    return { ...mapAccessOut(existing, client), ...inviteMeta };
  }

  const now = db.fn.now();
  if (existing && existing.status === STATUSES.REVOKED) {
    await db('case_client_access').where({ id: existing.id }).update({
      status: STATUSES.PENDING,
      invited_at: now,
      accepted_at: null,
      updated_at: now
    });
    const updated = await db('case_client_access').where({ id: existing.id }).first();
    const inviteMeta = await issueInvitationForAccess(updated, client, user);
    return { ...mapAccessOut(updated, client), ...inviteMeta };
  }

  const id = await insertReturningId(db, 'case_client_access', {
    case_id: caseId,
    client_id: clientId,
    status: STATUSES.PENDING,
    invited_at: now,
    accepted_at: null,
    created_at: now,
    updated_at: now
  });
  const row = await db('case_client_access').where({ id }).first();
  const inviteMeta = await issueInvitationForAccess(row, client, user);
  return { ...mapAccessOut(row, client), ...inviteMeta };
}

async function issueInvitationForAccess(accessRow, client, lawyerUser) {
  const { rawToken, invitationUrl } = await tokenService.createInvitationTokenForAccess(accessRow.id);
  const notify = await sendClientInvitation({
    client,
    lawyerName: lawyerUser.name,
    invitationUrl
  });
  const out = {
    invitationSent: !!notify.ok,
    invitationSmsStatus: notify.status || (notify.ok ? 'sent' : 'provider_failed'),
    invitationUrl: config.isProd ? undefined : invitationUrl
  };
  if (!config.isProd) {
    out.invitationToken = rawToken;
  }
  return out;
}

async function listCaseClientAccess(caseId, user) {
  await assertCaseAccess(caseId, user);
  const rows = await db('case_client_access')
    .where({ case_id: caseId })
    .orderBy('id', 'desc');
  const clientIds = [...new Set(rows.map((r) => r.client_id))];
  const clients = clientIds.length
    ? await db('clients').whereIn('id', clientIds).select('id', 'name', 'phone', 'owner_id')
    : [];
  const byId = new Map(clients.map((c) => [c.id, c]));
  return rows.map((r) => mapAccessOut(r, byId.get(r.client_id)));
}

async function revokeCaseClientAccess(caseId, accessId, user) {
  await assertCaseAccess(caseId, user);
  const row = await getAccessRowForCase(accessId, caseId);
  if (row.status === STATUSES.REVOKED) {
    return mapAccessOut(row, await db('clients').where({ id: row.client_id }).first());
  }
  await db('case_client_access').where({ id: row.id }).update({
    status: STATUSES.REVOKED,
    updated_at: db.fn.now()
  });
  await tokenService.invalidateTokensForAccess(row.id);
  const updated = await db('case_client_access').where({ id: row.id }).first();
  const client = await db('clients').where({ id: updated.client_id }).first();
  return mapAccessOut(updated, client);
}

/**
 * Client portal gate — ALL of:
 * 1) role client (caller should enforce)
 * 2) clients.user_id = authenticated user
 * 3) case_client_access.client_id = that client row
 * 4) case_client_access.case_id = requested case
 * 5) case_client_access.status = active
 *
 * Never grants access via clients.case_id, phone, or lawyer ownership alone.
 */
async function assertClientActiveCaseAccess(caseId, user) {
  const id = Number(caseId);
  const uid = Number(user?.id);
  if (!Number.isInteger(id) || id <= 0) {
    throw new AppError('پرونده یافت نشد', 404);
  }
  if (!Number.isInteger(uid) || uid <= 0) {
    throw new AppError('پرونده یافت نشد', 404);
  }

  const access = await db('case_client_access as a')
    .join('clients as c', 'c.id', 'a.client_id')
    .where('a.case_id', id)
    .where('a.status', STATUSES.ACTIVE)
    .where('c.user_id', uid)
    .whereNotNull('c.user_id')
    .select('a.*', 'c.id as cid', 'c.name as client_name')
    .first();

  if (!access) {
    throw new AppError('پرونده یافت نشد', 404);
  }

  const caseRow = await db('cases').where({ id }).first();
  if (!caseRow) throw new AppError('پرونده یافت نشد', 404);

  return { access, caseRow };
}

async function listPortalCases(user) {
  if (!user || user.role !== 'client') {
    throw new AppError('دسترسی مجاز نیست', 403);
  }
  const uid = Number(user.id);
  if (!Number.isInteger(uid) || uid <= 0) return [];

  const accessRows = await db('case_client_access as a')
    .join('clients as c', 'c.id', 'a.client_id')
    .where('a.status', STATUSES.ACTIVE)
    .where('c.user_id', uid)
    .whereNotNull('c.user_id')
    .select('a.case_id', 'a.accepted_at')
    .orderBy('a.accepted_at', 'desc');

  const seen = new Set();
  const orderedCaseIds = [];
  for (const row of accessRows) {
    const cid = Number(row.case_id);
    if (!cid || seen.has(cid)) continue;
    seen.add(cid);
    orderedCaseIds.push({ caseId: cid, acceptedAt: row.accepted_at });
  }
  if (!orderedCaseIds.length) return [];

  const caseRows = await db('cases')
    .whereIn('id', orderedCaseIds.map((x) => x.caseId))
    .select('id', 'case_number', 'title', 'status', 'branch');
  const byId = new Map(caseRows.map((r) => [r.id, r]));

  return orderedCaseIds
    .map(({ caseId, acceptedAt }) => {
      const cs = byId.get(caseId);
      if (!cs) return null;
      return {
        id: cs.id,
        num: cs.case_number,
        title: cs.title,
        status: cs.status,
        branch: cs.branch || null,
        acceptedAt
      };
    })
    .filter(Boolean);
}

async function getPortalCase(caseId, user) {
  const { caseRow } = await assertClientActiveCaseAccess(caseId, user);
  return {
    id: caseRow.id,
    num: caseRow.case_number,
    title: caseRow.title,
    status: caseRow.status,
    branch: caseRow.branch || null,
    description: caseRow.description || null,
    createdAt: caseRow.created_at || null,
    updatedAt: caseRow.updated_at || null
  };
}

async function loadClientUserPhone(user) {
  if (user.phone) return user.phone;
  const row = await db('users').where({ id: user.id }).select('phone').first();
  return row?.phone || null;
}

function userMayAccessPendingInvite(clientRow, user) {
  if (!clientRow) return false;
  if (clientRow.user_id != null) return clientRow.user_id === user.id;
  return phonesMatch(clientRow.phone, user.phone);
}

/**
 * Client accepts pending invite — links clients.user_id when null (phone match).
 */
async function acceptClientAccess(accessId, user) {
  const userPhone = await loadClientUserPhone(user);

  return db.transaction(async (trx) => {
    const row = await trx('case_client_access').where({ id: accessId }).first();
    if (!row) throw new AppError('دعوت یافت نشد', 404);

    let clientQuery = trx('clients').where({ id: row.client_id });
    const dbClient = trx.client.config.client;
    if (dbClient === 'mysql2' || dbClient === 'mysql') {
      clientQuery = clientQuery.forUpdate();
    }
    const client = await clientQuery.first();
    if (!client) throw new AppError('دعوت یافت نشد', 404);

    if (row.status === STATUSES.REVOKED) {
      throw new AppError('این دعوت دیگر معتبر نیست', 403);
    }

    if (row.status === STATUSES.ACTIVE) {
      if (client.user_id === user.id) return mapAccessOut(row, client);
      throw new AppError('دعوت یافت نشد', 404);
    }

    if (row.status !== STATUSES.PENDING) {
      throw new AppError('وضعیت دعوت نامعتبر است', 400);
    }

    if (client.user_id != null && client.user_id !== user.id) {
      throw new AppError('دعوت یافت نشد', 404);
    }

    if (client.user_id == null) {
      if (!phonesMatch(client.phone, userPhone)) {
        throw new AppError('دعوت یافت نشد', 404);
      }
      const linked = await trx('clients')
        .where({ id: client.id })
        .whereNull('user_id')
        .update({ user_id: user.id });
      if (!linked) {
        throw new AppError(
          'امکان اتصال حساب به موکل وجود ندارد. ممکن است قبلاً توسط شخص دیگری ثبت شده باشد.',
          409,
          { code: 'CLIENT_ALREADY_CLAIMED' }
        );
      }
    }

    const acceptedAt = toDbDateTime(new Date());
    const activated = await trx('case_client_access')
      .where({ id: row.id, status: STATUSES.PENDING })
      .update({
        status: STATUSES.ACTIVE,
        accepted_at: acceptedAt,
        updated_at: trx.fn.now()
      });
    if (!activated) {
      throw new AppError('وضعیت دعوت نامعتبر است', 409);
    }

    const updated = await trx('case_client_access').where({ id: row.id }).first();
    const updatedClient = await trx('clients').where({ id: client.id }).first();
    return mapAccessOut(updated, updatedClient);
  });
}

/** Pending invites: linked user or unclaimed client with matching phone. */
async function acceptClientAccessByToken(rawToken, user) {
  const tokenRow = await tokenService.assertTokenAcceptable(rawToken);
  const result = await acceptClientAccess(tokenRow.access_id, user);
  await tokenService.markTokenUsed(tokenRow.token_id);
  return result;
}

async function listMyPendingInvites(user) {
  const userPhone = await loadClientUserPhone(user);
  const rows = await db('case_client_access as a')
    .join('clients as c', 'c.id', 'a.client_id')
    .join('cases as cs', 'cs.id', 'a.case_id')
    .where('a.status', STATUSES.PENDING)
    .where(function () {
      this.where('c.user_id', user.id).orWhereNull('c.user_id');
    })
    .select(
      'a.id',
      'a.case_id',
      'a.client_id',
      'a.status',
      'a.invited_at',
      'c.user_id as client_user_id',
      'c.phone as client_phone',
      'cs.title as case_title',
      'cs.case_number'
    )
    .orderBy('a.invited_at', 'desc');

  return rows
    .filter((r) => userMayAccessPendingInvite(
      { user_id: r.client_user_id, phone: r.client_phone },
      { id: user.id, phone: userPhone }
    ))
    .map((r) => ({
      id: r.id,
      caseId: r.case_id,
      clientId: r.client_id,
      status: r.status,
      invitedAt: r.invited_at,
      caseTitle: r.case_title,
      caseNumber: r.case_number
    }));
}

module.exports = {
  STATUSES,
  inviteClientToCase,
  listCaseClientAccess,
  revokeCaseClientAccess,
  assertClientActiveCaseAccess,
  listPortalCases,
  getPortalCase,
  acceptClientAccess,
  acceptClientAccessByToken,
  listMyPendingInvites,
  mapAccessOut
};
