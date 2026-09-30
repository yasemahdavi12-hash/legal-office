const db = require('../db/connection');
const { AppError } = require('../utils/response');
const {
  PLANS,
  FREE_CASE_LIMIT,
  PRO_MONTHLY_PRICE_TOMAN,
  ERROR_CODE_QUOTA
} = require('../config/subscription');
const { insertReturningId, toDbDateTime, parseDbDateTime } = require('../utils/dbHelpers');
const { writeAudit } = require('./audit.service');

function parseExpiry(value) {
  return parseDbDateTime(value);
}

/**
 * Effective plan: expired PRO falls back to FREE without deleting data.
 */
function getEffectivePlan(user) {
  if (!user) return PLANS.FREE;
  if (user.subscription_plan === PLANS.PRO) {
    const exp = parseExpiry(user.subscription_expires_at);
    // null expiry = non-expiring PRO (ops/admin grant)
    if (exp === null || exp > Date.now()) return PLANS.PRO;
  }
  return PLANS.FREE;
}

async function countTotalCases(userId) {
  const [row] = await db('cases').where({ owner_id: userId }).count({ c: '*' });
  return Number(row?.c || 0);
}

async function getSubscriptionStatus(user) {
  const row = await db('users').where({ id: user.id }).first();
  if (!row) throw new AppError('کاربر یافت نشد', 404);

  const plan = getEffectivePlan(row);
  const totalCases = await countTotalCases(row.id);
  const limit = plan === PLANS.PRO ? null : FREE_CASE_LIMIT;
  const canCreateCase = plan === PLANS.PRO || totalCases < FREE_CASE_LIMIT;

  return {
    plan,
    storedPlan: row.subscription_plan || PLANS.FREE,
    expiresAt: row.subscription_expires_at || null,
    isExpiredPro:
      row.subscription_plan === PLANS.PRO && plan === PLANS.FREE,
    totalCases,
    /** Quota counts ALL cases (any status). Archive does not free quota. */
    caseLimit: limit,
    canCreateCase,
    proMonthlyPriceToman: PRO_MONTHLY_PRICE_TOMAN,
    freeCaseLimit: FREE_CASE_LIMIT
  };
}

/**
 * Enforce FREE total-case quota before creating a case.
 * PRO (non-expired) is unlimited.
 */
async function assertCanCreateCase(user) {
  const row = await db('users').where({ id: user.id }).first();
  if (!row) throw new AppError('کاربر یافت نشد', 404);

  const plan = getEffectivePlan(row);
  if (plan === PLANS.PRO) return { plan, totalCases: await countTotalCases(row.id) };

  const totalCases = await countTotalCases(row.id);
  if (totalCases >= FREE_CASE_LIMIT) {
    throw new AppError(
      `سقف طرح رایگان ${FREE_CASE_LIMIT} پرونده است. برای ایجاد پرونده بیشتر به طرح PRO نیاز دارید.`,
      403,
      {
        code: ERROR_CODE_QUOTA,
        plan: PLANS.FREE,
        totalCases,
        caseLimit: FREE_CASE_LIMIT,
        proMonthlyPriceToman: PRO_MONTHLY_PRICE_TOMAN
      }
    );
  }
  return { plan, totalCases };
}

function addOneMonth(fromDate) {
  const d = new Date(fromDate);
  d.setMonth(d.getMonth() + 1);
  return d;
}

/**
 * After verified payment: activate/extend PRO. Never deletes cases.
 * - Active PRO → add 1 month to current expires_at
 * - Expired / FREE → 1 month from now
 */
async function activateProFromVerifiedPayment(userId, { paymentId, note } = {}, trx = db) {
  const user = await trx('users').where({ id: userId }).first();
  if (!user) throw new AppError('کاربر یافت نشد', 404);

  const now = Date.now();
  const currentExp = parseExpiry(user.subscription_expires_at);
  const effective = getEffectivePlan(user);
  let nextExpires;
  if (effective === PLANS.PRO && currentExp && currentExp > now) {
    nextExpires = addOneMonth(new Date(currentExp));
  } else {
    nextExpires = addOneMonth(new Date(now));
  }
  const expiresIso = toDbDateTime(nextExpires);

  await trx('users').where({ id: userId }).update({
    subscription_plan: PLANS.PRO,
    subscription_expires_at: expiresIso
  });

  await insertReturningId(trx, 'subscription_events', {
    user_id: userId,
    plan: PLANS.PRO,
    expires_at: expiresIso,
    source: 'payment',
    note: note || (paymentId ? `payment:${paymentId}` : 'zarinpal'),
    payment_id: paymentId || null,
    actor_id: null,
    created_at: trx.fn.now()
  });

  await writeAudit({
    userId,
    action: 'SUBSCRIPTION_ACTIVATE',
    entityType: 'subscription',
    entityId: userId,
    changes: { plan: PLANS.PRO, expires_at: expiresIso, paymentId: paymentId || null },
    ip: null
  }, trx);

  return { plan: PLANS.PRO, expiresAt: expiresIso };
}

/**
 * Admin/ops: set plan. Does NOT delete cases on downgrade/expiry.
 */
async function setUserSubscription(userId, { plan, expiresAt, note } = {}, actor = null) {
  const user = await db('users').where({ id: userId }).first();
  if (!user) throw new AppError('کاربر یافت نشد', 404);

  const nextPlan = plan === PLANS.PRO ? PLANS.PRO : PLANS.FREE;
  let nextExpires = null;
  if (nextPlan === PLANS.PRO) {
    if (expiresAt === undefined || expiresAt === null || expiresAt === '') {
      // default 30 days
      nextExpires = toDbDateTime(new Date(Date.now() + 30 * 24 * 3600 * 1000));
    } else {
      const t = parseExpiry(expiresAt);
      if (t === null) throw new AppError('تاریخ انقضای اشتراک نامعتبر است', 400);
      nextExpires = toDbDateTime(new Date(t));
    }
  }

  await db('users').where({ id: userId }).update({
    subscription_plan: nextPlan,
    subscription_expires_at: nextExpires
  });

  await insertReturningId(db, 'subscription_events', {
    user_id: userId,
    plan: nextPlan,
    expires_at: nextExpires,
    source: 'admin',
    note: note || null,
    actor_id: actor?.id || null,
    created_at: db.fn.now()
  });

  const updated = await db('users').where({ id: userId }).first();
  return getSubscriptionStatus(updated);
}

module.exports = {
  getEffectivePlan,
  countTotalCases,
  getSubscriptionStatus,
  assertCanCreateCase,
  setUserSubscription,
  activateProFromVerifiedPayment,
  addOneMonth,
  PLANS,
  FREE_CASE_LIMIT,
  PRO_MONTHLY_PRICE_TOMAN,
  ERROR_CODE_QUOTA
};
