const { MessengerInterface } = require('./MessengerInterface');
const { AppError } = require('../../utils/response');

/** Official Bale Bot API — https://docs.bale.ai/ */
const BALE_API_BASE = 'https://tapi.bale.ai/bot';

function normalizeChatId(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (s.startsWith('@')) return s;
  if (/^-?\d+$/.test(s)) return Number(s);
  return s;
}

function mapBaleError(data, httpStatus) {
  const code = data?.error_code;
  const desc = (data?.description && String(data.description)) || 'خطای API بله';
  if (code === 401 || /unauthorized|token/i.test(desc)) {
    return new AppError('توکن بازوی بله نامعتبر است', 401);
  }
  if (code === 400 || httpStatus === 400) {
    return new AppError(desc, 400);
  }
  if (code === 403) {
    return new AppError(desc, 403);
  }
  return new AppError(desc, 502);
}

async function baleApiCall(token, method, jsonBody = {}) {
  const t = String(token || '').trim();
  if (!t) throw new AppError('توکن بله تنظیم نشده است', 400);
  const url = `${BALE_API_BASE}${t}/${method}`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(jsonBody || {})
    });
  } catch {
    throw new AppError('ارتباط با سرور بله برقرار نشد', 502);
  }
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (data.ok === false) {
    throw mapBaleError(data, res.status);
  }
  if (!res.ok) {
    throw new AppError('پاسخ نامعتبر از سرور بله', 502);
  }
  return data.result !== undefined ? data.result : data;
}

/**
 * Bale messenger — official Bot API (sendMessage, getMe).
 */
class BaleService extends MessengerInterface {
  constructor() {
    super('bale');
  }

  /** Validate bot token via getMe (no in-memory session). */
  async connect(settings = {}) {
    const token = settings.token;
    if (!token || !String(token).trim()) {
      throw new AppError('توکن بله الزامی است', 400);
    }
    const me = await baleApiCall(token, 'getMe', {});
    return {
      platform: this.platform,
      connected: true,
      message: 'اتصال بله برقرار شد.',
      bot: me?.username || me?.first_name || me?.id || null
    };
  }

  async disconnect() {
    return { platform: this.platform, connected: false };
  }

  /**
   * @param {{ token: string, chatId: string|number, text: string }} payload
   */
  async sendMessage(payload = {}) {
    const token = payload.token;
    const text = String(payload.text ?? payload.message ?? '').trim();
    const chatId = normalizeChatId(payload.chatId ?? payload.chat_id ?? payload.target);
    if (!text) throw new AppError('متن پیام الزامی است', 400);
    if (chatId == null || chatId === '') {
      throw new AppError('شناسه گفتگو (chat_id) الزامی است', 400);
    }
    if (text.length > 4096) {
      throw new AppError('متن پیام بیش از ۴۰۹۶ کاراکتر است', 400);
    }
    const message = await baleApiCall(token, 'sendMessage', { chat_id: chatId, text });
    return { platform: this.platform, sent: true, message };
  }

  async manageChannel() {
    throw new AppError('مدیریت کانال بله هنوز پیاده‌سازی نشده است', 501);
  }

  async manageGroup() {
    throw new AppError('مدیریت گروه بله هنوز پیاده‌سازی نشده است', 501);
  }

  /** @param {{ offset?: number, timeout?: number, limit?: number }} opts */
  async getUpdates(token, opts = {}) {
    const body = {};
    if (opts.offset != null && Number(opts.offset) > 0) body.offset = Number(opts.offset);
    if (opts.timeout != null) body.timeout = Number(opts.timeout);
    if (opts.limit != null) body.limit = Number(opts.limit);
    return baleApiCall(token, 'getUpdates', body);
  }

  async setWebhook(token, url) {
    return baleApiCall(token, 'setWebhook', { url: String(url) });
  }

  async deleteWebhook(token) {
    return baleApiCall(token, 'deleteWebhook', {});
  }
}

module.exports = { BaleService, baleApiCall, normalizeChatId, BALE_API_BASE };
