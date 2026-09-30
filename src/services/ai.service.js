const db = require('../db/connection');
const config = require('../config');
const { AppError } = require('../utils/response');
const { getSubscriptionStatus, PLANS } = require('./subscription.service');
const { assertCaseAccess } = require('./case.service');
const { getAiProvider, isAiConfigured } = require('./ai');

const DISCLAIMER =
  'این پاسخ صرفاً اطلاعات عمومی است و جایگزین مشاوره و بررسی توسط وکیل نیست.';

const ERROR_CODE_AI_PRO = 'AI_PRO_REQUIRED';
const ERROR_CODE_AI_DISABLED = 'AI_NOT_CONFIGURED';

async function assertProForAi(user) {
  // Always re-read subscription from DB via existing service (ignore any client plan claim)
  const status = await getSubscriptionStatus(user);
  if (status.plan !== PLANS.PRO) {
    throw new AppError('دستیار هوشمند فقط در پلن PRO فعال است.', 403, {
      code: ERROR_CODE_AI_PRO,
      plan: status.plan
    });
  }
  return status;
}

function sanitizeMessage(raw, maxChars) {
  const text = String(raw || '').trim();
  if (!text) throw new AppError('پیام الزامی است', 400);
  if (text.length > maxChars) {
    throw new AppError(`پیام نباید بیش از ${maxChars} کاراکتر باشد`, 400);
  }
  return text;
}

/**
 * Build optional case context after ownership check.
 * Text fields only — no document binary / extraction.
 */
async function buildCaseContext(caseId, user) {
  if (caseId === undefined || caseId === null || caseId === '') return '';
  const id = Number(caseId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new AppError('شناسه پرونده نامعتبر است', 400);
  }

  const row = await assertCaseAccess(id, user);
  const clients = await db('clients').where({ case_id: id }).select('name', 'phone', 'national_id', 'description');
  const notes = await db('notes')
    .where({ case_id: id })
    .orderBy('created_at', 'desc')
    .limit(8)
    .select('title', 'content', 'category');

  const parts = [
    `پرونده: ${row.title || '—'}`,
    `شماره: ${row.case_number || '—'}`,
    `وضعیت: ${row.status || '—'}`,
    row.description ? `شرح: ${String(row.description).slice(0, 1500)}` : null,
    clients.length
      ? `موکلین: ${clients.map((c) => c.name).filter(Boolean).join('، ')}`
      : null,
    notes.length
      ? `یادداشت‌ها:\n${notes
          .map((n) => `- ${n.title}: ${String(n.content || '').slice(0, 400)}`)
          .join('\n')}`
      : null
  ].filter(Boolean);

  return parts.join('\n').slice(0, config.ai.maxContextChars);
}

function systemPrompt() {
  return [
    'شما یک دستیار حقوقی عمومی برای وکلا در ایران هستید.',
    'پاسخ‌ها را کوتاه، واضح و به فارسی بنویسید.',
    'اگر اطلاعات پرونده ناقص است، فرض نکنید و بگویید چه چیزی لازم است.',
    `همیشه در پایان پاسخ این جمله را عیناً بیاورید: ${DISCLAIMER}`
  ].join('\n');
}

async function chat(user, body = {}) {
  await assertProForAi(user);

  const provider = getAiProvider();
  if (!provider) {
    throw new AppError('دستیار هوشمند فعلاً در دسترس نیست.', 503, {
      code: ERROR_CODE_AI_DISABLED
    });
  }

  // Ignore any client-supplied plan / subscription fields
  const message = sanitizeMessage(body.message || body.text || body.prompt, config.ai.maxInputChars);
  const caseId = body.caseId ?? body.case_id ?? null;
  const context = await buildCaseContext(caseId, user);

  const userPayload = context
    ? `زمینه پرونده (فقط داده‌های مجاز کاربر):\n${context}\n\nسؤال:\n${message}`
    : message;

  let result;
  try {
    result = await provider.chat({
      system: systemPrompt(),
      user: userPayload,
      maxTokens: config.ai.maxOutputTokens
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('خطا در دریافت پاسخ از سرویس هوش مصنوعی.', 502, {
      code: 'AI_PROVIDER_ERROR'
    });
  }

  let reply = String(result?.text || '').trim();
  if (!reply.includes(DISCLAIMER)) {
    reply = `${reply}\n\n${DISCLAIMER}`;
  }

  return {
    reply,
    disclaimer: DISCLAIMER,
    plan: PLANS.PRO,
    caseId: caseId ? Number(caseId) : null
  };
}

/** Lightweight status for UI (no secrets). */
async function getAiStatus(user) {
  const status = await getSubscriptionStatus(user);
  const isPro = status.plan === PLANS.PRO;
  return {
    available: isPro && isAiConfigured(),
    requiresPro: !isPro,
    plan: status.plan,
    enabled: !!config.ai.enabled,
    configured: isAiConfigured(),
    dailyLimit: config.ai.dailyLimitPro,
    disclaimer: DISCLAIMER
  };
}

module.exports = {
  chat,
  getAiStatus,
  assertProForAi,
  DISCLAIMER,
  ERROR_CODE_AI_PRO,
  ERROR_CODE_AI_DISABLED,
  PLANS
};
