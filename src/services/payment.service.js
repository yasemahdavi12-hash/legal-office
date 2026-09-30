const db = require('../db/connection');
const config = require('../config');
const { AppError } = require('../utils/response');
const { insertReturningId } = require('../utils/dbHelpers');
const { getPaymentProvider } = require('./payment');
const {
  activateProFromVerifiedPayment,
  getSubscriptionStatus,
  PLANS,
  PRO_MONTHLY_PRICE_TOMAN
} = require('./subscription.service');
const { PRO_CURRENCY } = require('../config/subscription');
const { writeAudit } = require('./audit.service');

const FRONTEND_RESULT_PATH = '/';

function frontendRedirect(query) {
  const base = (config.corsOrigins && config.corsOrigins[0]) || `http://localhost:${config.port}`;
  const url = new URL(FRONTEND_RESULT_PATH, base.endsWith('/') ? base : `${base}/`);
  Object.entries(query || {}).forEach(([k, v]) => {
    if (v != null && v !== '') url.searchParams.set(k, String(v));
  });
  return url.toString();
}

function isUniqueViolation(err) {
  if (!err) return false;
  const code = err.code || err.errno;
  const msg = String(err.message || '');
  return (
    code === 'SQLITE_CONSTRAINT' ||
    code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    code === 1062 ||
    code === 'ER_DUP_ENTRY' ||
    /UNIQUE constraint failed/i.test(msg) ||
    /Duplicate entry/i.test(msg)
  );
}

/**
 * Create ZarinPal payment request. Amount/plan are server-controlled.
 * Wrong client amount/plan are rejected; omitted fields are fine.
 */
async function checkout(user, body = {}) {
  if (body.amount !== undefined && body.amount !== null && body.amount !== '') {
    if (Number(body.amount) !== PRO_MONTHLY_PRICE_TOMAN) {
      throw new AppError('مبلغ پرداخت نامعتبر است', 400, { code: 'INVALID_AMOUNT' });
    }
  }
  if (body.plan !== undefined && body.plan !== null && body.plan !== '') {
    if (String(body.plan).toLowerCase() !== PLANS.PRO) {
      throw new AppError('طرح پرداخت نامعتبر است', 400, { code: 'INVALID_PLAN' });
    }
  }

  const provider = getPaymentProvider();
  if (!provider) {
    throw new AppError('درگاه پرداخت پیکربندی نشده است (ZARINPAL_MERCHANT_ID)', 503);
  }
  const callbackUrl = config.zarinpal.callbackUrl;
  if (!callbackUrl) {
    throw new AppError('ZARINPAL_CALLBACK_URL تنظیم نشده است', 503);
  }

  const amount = PRO_MONTHLY_PRICE_TOMAN;
  const plan = PLANS.PRO;
  const description = `اشتراک حرفه‌ای قانون در جیب شما — ${amount} تومان`;

  const paymentId = await insertReturningId(db, 'payments', {
    user_id: user.id,
    amount,
    currency: PRO_CURRENCY,
    plan,
    gateway: 'zarinpal',
    authority: null,
    status: 'pending',
    ref_id: null,
    description,
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });

  let authority;
  let paymentUrl;
  try {
    const result = await provider.requestPayment({
      amount,
      currency: PRO_CURRENCY,
      description,
      callbackUrl,
      email: user.email || undefined,
      mobile: user.phone || undefined
    });
    authority = result.authority;
    paymentUrl = result.paymentUrl;
  } catch (err) {
    await db('payments').where({ id: paymentId }).update({
      status: 'failed',
      gateway_message: err.message || 'request failed',
      updated_at: db.fn.now()
    });
    throw err;
  }

  await db('payments').where({ id: paymentId }).update({
    authority,
    updated_at: db.fn.now()
  });

  await writeAudit({
    userId: user.id,
    action: 'PAYMENT_CHECKOUT',
    entityType: 'payment',
    entityId: paymentId,
    changes: { amount, plan, gateway: 'zarinpal' },
    ip: null
  });

  return {
    ok: true,
    paymentId,
    authority,
    paymentUrl,
    amount,
    currency: PRO_CURRENCY,
    plan,
    sandbox: !!config.zarinpal.sandbox
  };
}

/**
 * Idempotent PRO activation for a verified payment.
 * Locks the payment row; DB unique(payment_id) prevents double activation.
 * If verify succeeded but this trx fails, payment stays non-paid so retry is safe.
 */
async function ensureProActivatedForPayment(paymentId, verify, trx) {
  const locked = await trx('payments').where({ id: paymentId }).forUpdate().first();
  if (!locked) return;

  const note = `payment:${locked.id}`;
  const paidPatch = {
    status: 'paid',
    ref_id: verify.refId != null ? String(verify.refId) : null,
    card_pan: verify.cardPan || null,
    gateway_message: verify.message || null,
    paid_at: trx.fn.now(),
    updated_at: trx.fn.now()
  };

  if (locked.status === 'paid') {
    return;
  }

  const alreadyByPayment = await trx('subscription_events')
    .where({ payment_id: locked.id })
    .first();
  if (alreadyByPayment) {
    await trx('payments').where({ id: locked.id }).update(paidPatch);
    return;
  }

  const alreadyByNote = await trx('subscription_events')
    .where({ user_id: locked.user_id, source: 'payment', note })
    .first();
  if (alreadyByNote) {
    if (!alreadyByNote.payment_id) {
      try {
        await trx('subscription_events').where({ id: alreadyByNote.id }).update({ payment_id: locked.id });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
    }
    await trx('payments').where({ id: locked.id }).update(paidPatch);
    return;
  }

  // Mark paid only from pending/cancelled, then activate — all in this trx
  const marked = await trx('payments')
    .where({ id: locked.id })
    .whereIn('status', ['pending', 'cancelled'])
    .update(paidPatch);

  if (!marked) {
    const row = await trx('payments').where({ id: locked.id }).first();
    if (row && row.status === 'paid') return;
    return;
  }

  try {
    await activateProFromVerifiedPayment(
      locked.user_id,
      { paymentId: locked.id, note },
      trx
    );
  } catch (err) {
    if (isUniqueViolation(err)) {
      // Concurrent winner already activated — stay paid, do not re-extend
      return;
    }
    throw err;
  }
}

/**
 * ZarinPal callback — authority-bound, idempotent, only activates after verify.
 */
async function handleCallback({ authority, status }) {
  const auth = String(authority || '').trim();
  if (!auth || auth.length < 8) {
    return { redirectUrl: frontendRedirect({ payment: 'failed', reason: 'invalid_authority' }) };
  }

  // Reject obvious injection attempts in authority
  if (!/^[A-Za-z0-9]+$/.test(auth)) {
    return { redirectUrl: frontendRedirect({ payment: 'failed', reason: 'invalid_authority' }) };
  }

  const payment = await db('payments').where({ authority: auth }).first();
  if (!payment) {
    return { redirectUrl: frontendRedirect({ payment: 'failed', reason: 'unknown_authority' }) };
  }

  if (payment.status === 'paid') {
    const sub = await getSubscriptionStatus({ id: payment.user_id });
    return {
      redirectUrl: frontendRedirect({
        payment: 'success',
        ref: payment.ref_id || '',
        plan: sub.plan
      })
    };
  }

  if (String(status || '').toUpperCase() !== 'OK') {
    if (payment.status === 'pending') {
      await db('payments').where({ id: payment.id, status: 'pending' }).update({
        status: 'cancelled',
        gateway_message: `callback status=${status}`,
        updated_at: db.fn.now()
      });
    }
    return { redirectUrl: frontendRedirect({ payment: 'failed', reason: 'cancelled' }) };
  }

  if (Number(payment.amount) !== PRO_MONTHLY_PRICE_TOMAN || payment.plan !== PLANS.PRO) {
    await db('payments').where({ id: payment.id }).update({
      status: 'failed',
      gateway_message: 'amount/plan mismatch',
      updated_at: db.fn.now()
    });
    return { redirectUrl: frontendRedirect({ payment: 'failed', reason: 'invalid_payment' }) };
  }

  const provider = getPaymentProvider();
  if (!provider) {
    return { redirectUrl: frontendRedirect({ payment: 'failed', reason: 'gateway_unconfigured' }) };
  }

  const verify = await provider.verifyPayment({
    amount: payment.amount,
    currency: payment.currency || PRO_CURRENCY,
    authority: auth
  });

  if (!verify.ok) {
    await db('payments').where({ id: payment.id, status: 'pending' }).update({
      status: 'failed',
      gateway_message: verify.message || `verify code ${verify.code}`,
      updated_at: db.fn.now()
    });
    return { redirectUrl: frontendRedirect({ payment: 'failed', reason: 'verify_failed' }) };
  }

  // Activation is transactional + row-locked; failure leaves non-paid for safe retry
  await db.transaction(async (trx) => {
    await ensureProActivatedForPayment(payment.id, verify, trx);
  });

  await writeAudit({
    userId: payment.user_id,
    action: 'PAYMENT_PAID',
    entityType: 'payment',
    entityId: payment.id,
    changes: { amount: payment.amount, plan: payment.plan },
    ip: null
  });

  const sub = await getSubscriptionStatus({ id: payment.user_id });
  const paidRow = await db('payments').where({ id: payment.id }).first();
  return {
    redirectUrl: frontendRedirect({
      payment: 'success',
      ref: (paidRow && paidRow.ref_id) || String(verify.refId || ''),
      plan: sub.plan
    })
  };
}

module.exports = { checkout, handleCallback, frontendRedirect, ensureProActivatedForPayment };
