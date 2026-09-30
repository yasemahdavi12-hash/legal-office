const db = require('../db/connection');
const { AppError } = require('../utils/response');
const { assertCaseAccess } = require('./case.service');
const { assertClientActiveCaseAccess } = require('./caseClientAccess.service');
const { insertReturningId } = require('../utils/dbHelpers');
const { emitCaseFinanceNotification } = require('./caseFinanceNotification.hook');

const PAYMENT_STATUS = Object.freeze({
  RECORDED: 'recorded',
  CANCELLED: 'cancelled'
});

const MAX_DESC = 500;
const DEFAULT_CURRENCY = 'IRR';

function parseMoneyInt(value) {
  if (value == null || value === '') return 0n;
  const s = String(value).trim();
  if (!/^-?\d+(\.0+)?$/.test(s)) {
    const n = Number(s);
    if (!Number.isFinite(n)) return 0n;
    return BigInt(Math.trunc(n));
  }
  const intPart = s.split('.')[0];
  return BigInt(intPart);
}

function moneyToResponse(n) {
  const bi = typeof n === 'bigint' ? n : BigInt(n);
  if (bi > BigInt(Number.MAX_SAFE_INTEGER) || bi < BigInt(Number.MIN_SAFE_INTEGER)) {
    return bi.toString();
  }
  return Number(bi);
}

function normalizeAgreedFee(raw) {
  if (raw == null || raw === '') {
    throw new AppError('مبلغ حق‌الوکاله الزامی است', 400);
  }
  const bi = parseMoneyInt(raw);
  if (bi < 0n) throw new AppError('حق‌الوکاله نمی‌تواند منفی باشد', 400);
  return bi;
}

function normalizePaymentAmount(raw) {
  if (raw == null || raw === '') {
    throw new AppError('مبلغ پرداخت الزامی است', 400);
  }
  const bi = parseMoneyInt(raw);
  if (bi <= 0n) throw new AppError('مبلغ پرداخت باید بزرگ‌تر از صفر باشد', 400);
  return bi;
}

function normalizePaymentDate(raw) {
  const s = String(raw ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new AppError('تاریخ پرداخت نامعتبر است (YYYY-MM-DD)', 400);
  }
  const d = new Date(`${s}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new AppError('تاریخ پرداخت نامعتبر است', 400);
  return s;
}

function normalizeDescription(raw) {
  if (raw == null || raw === '') return null;
  const description = String(raw).trim();
  if (!description) return null;
  if (description.length > MAX_DESC) {
    throw new AppError(`توضیحات حداکثر ${MAX_DESC} کاراکتر`, 400);
  }
  return description;
}

function mapFinancialRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    caseId: row.case_id,
    agreedFee: moneyToResponse(parseMoneyInt(row.agreed_fee)),
    currency: row.currency || DEFAULT_CURRENCY,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapPaymentRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    caseId: row.case_id,
    amount: moneyToResponse(parseMoneyInt(row.amount)),
    currency: row.currency || DEFAULT_CURRENCY,
    paymentDate: row.payment_date,
    description: row.description || null,
    status: row.status,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function sumRecordedPayments(caseId, trx) {
  const knex = trx || db;
  const row = await knex('case_payments')
    .where({ case_id: caseId, status: PAYMENT_STATUS.RECORDED })
    .sum({ total: 'amount' })
    .first();
  return parseMoneyInt(row?.total ?? 0);
}

async function buildSummary(caseId, trx) {
  const knex = trx || db;
  const fin = await knex('case_financials').where({ case_id: caseId }).first();
  const agreedFee = fin ? parseMoneyInt(fin.agreed_fee) : 0n;
  const currency = fin?.currency || DEFAULT_CURRENCY;
  const totalPaid = await sumRecordedPayments(caseId, trx);
  const remaining = agreedFee - totalPaid;
  return {
    agreedFee: moneyToResponse(agreedFee),
    totalPaid: moneyToResponse(totalPaid),
    remaining: moneyToResponse(remaining),
    overpaid: remaining < 0n,
    currency,
    financialId: fin?.id ?? null
  };
}

async function getFinanceForLawyer(caseId, user) {
  await assertCaseAccess(caseId, user);
  const summary = await buildSummary(caseId);
  const fin = await db('case_financials').where({ case_id: caseId }).first();
  return {
    ...summary,
    record: mapFinancialRow(fin)
  };
}

async function upsertAgreedFee(caseId, agreedFeeRaw, user) {
  await assertCaseAccess(caseId, user);
  const agreedFee = normalizeAgreedFee(agreedFeeRaw);

  return db.transaction(async (trx) => {
    let row = await trx('case_financials').where({ case_id: caseId }).first();
    const feeStr = agreedFee.toString();

    if (row) {
      await trx('case_financials')
        .where({ id: row.id })
        .update({ agreed_fee: feeStr, updated_at: trx.fn.now() });
      row = await trx('case_financials').where({ id: row.id }).first();
    } else {
      const id = await insertReturningId(trx, 'case_financials', {
        case_id: caseId,
        agreed_fee: feeStr,
        currency: DEFAULT_CURRENCY,
        created_at: trx.fn.now(),
        updated_at: trx.fn.now()
      });
      row = await trx('case_financials').where({ id }).first();
    }

    await emitCaseFinanceNotification(
      'fee_updated',
      {
        case_id: caseId,
        agreed_fee: feeStr,
        currency: row.currency,
        entity_id: row.id
      },
      user,
      trx
    );

    const summary = await buildSummary(caseId, trx);
    return { ...summary, record: mapFinancialRow(row) };
  });
}

async function listPaymentsForLawyer(caseId, user) {
  await assertCaseAccess(caseId, user);
  const rows = await db('case_payments')
    .where({ case_id: caseId })
    .orderBy([
      { column: 'payment_date', order: 'desc' },
      { column: 'id', order: 'desc' }
    ]);
  return rows.map(mapPaymentRow);
}

async function recordPayment(caseId, body, user) {
  await assertCaseAccess(caseId, user);
  const uid = Number(user?.id);
  if (!Number.isInteger(uid) || uid <= 0) {
    throw new AppError('دسترسی مجاز نیست', 403);
  }

  const amount = normalizePaymentAmount(body.amount);
  const paymentDate = normalizePaymentDate(body.paymentDate ?? body.payment_date);
  const description = normalizeDescription(body.description);

  return db.transaction(async (trx) => {
    const id = await insertReturningId(trx, 'case_payments', {
      case_id: caseId,
      amount: amount.toString(),
      currency: DEFAULT_CURRENCY,
      payment_date: paymentDate,
      description,
      status: PAYMENT_STATUS.RECORDED,
      created_by_user_id: uid,
      created_at: trx.fn.now(),
      updated_at: trx.fn.now()
    });
    const row = await trx('case_payments').where({ id }).first();

    await emitCaseFinanceNotification(
      'payment_recorded',
      {
        case_id: caseId,
        amount: row.amount,
        currency: row.currency,
        description: row.description,
        entity_id: row.id
      },
      user,
      trx
    );

    return mapPaymentRow(row);
  });
}

async function cancelPayment(caseId, paymentId, user) {
  await assertCaseAccess(caseId, user);
  const pid = Number(paymentId);
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new AppError('پرداخت یافت نشد', 404);
  }

  return db.transaction(async (trx) => {
    const row = await trx('case_payments')
      .where({ id: pid, case_id: caseId })
      .first();
    if (!row) throw new AppError('پرداخت یافت نشد', 404);
    if (row.status === PAYMENT_STATUS.CANCELLED) {
      throw new AppError('این پرداخت قبلاً لغو شده است', 400);
    }

    await trx('case_payments')
      .where({ id: pid })
      .update({ status: PAYMENT_STATUS.CANCELLED, updated_at: trx.fn.now() });
    const updated = await trx('case_payments').where({ id: pid }).first();

    await emitCaseFinanceNotification(
      'payment_cancelled',
      {
        case_id: caseId,
        amount: updated.amount,
        currency: updated.currency,
        description: updated.description,
        entity_id: updated.id
      },
      user,
      trx
    );

    return mapPaymentRow(updated);
  });
}

async function getFinanceForClient(caseId, user) {
  await assertClientActiveCaseAccess(caseId, user);
  return buildSummary(caseId);
}

async function listPaymentsForClient(caseId, user) {
  await assertClientActiveCaseAccess(caseId, user);
  const rows = await db('case_payments')
    .where({ case_id: caseId, status: PAYMENT_STATUS.RECORDED })
    .orderBy([
      { column: 'payment_date', order: 'desc' },
      { column: 'id', order: 'desc' }
    ]);
  return rows.map(mapPaymentRow);
}

module.exports = {
  PAYMENT_STATUS,
  parseMoneyInt,
  moneyToResponse,
  buildSummary,
  getFinanceForLawyer,
  upsertAgreedFee,
  listPaymentsForLawyer,
  recordPayment,
  cancelPayment,
  getFinanceForClient,
  listPaymentsForClient
};
