const https = require('https');
const { URL } = require('url');
const { PaymentProviderInterface } = require('./PaymentProviderInterface');
const { AppError } = require('../../utils/response');
const { safeLog } = require('../../utils/logger');

/**
 * Official ZarinPal REST API v4
 * Docs: https://next.zarinpal.com/paymentGateway/guide/
 * Sandbox: https://next.zarinpal.com/paymentGateway/sandbox.html
 * Currency: https://www.zarinpal.com/docs/paymentGateway/moreFeatures/currency
 */
class ZarinPalProvider extends PaymentProviderInterface {
  /**
   * @param {{ merchantId: string, sandbox: boolean }} opts
   */
  constructor(opts = {}) {
    super();
    this.merchantId = String(opts.merchantId || '').trim();
    this.sandbox = !!opts.sandbox;
    if (!this.merchantId || this.merchantId.length < 36) {
      throw new Error('[zarinpal] ZARINPAL_MERCHANT_ID must be a 36-char merchant id from ENV');
    }
  }

  get apiBase() {
    return this.sandbox
      ? 'https://sandbox.zarinpal.com'
      : 'https://api.zarinpal.com';
  }

  get startPayBase() {
    return this.sandbox
      ? 'https://sandbox.zarinpal.com/pg/StartPay/'
      : 'https://www.zarinpal.com/pg/StartPay/';
  }

  async requestPayment({ amount, currency = 'IRT', description, callbackUrl, email, mobile }) {
    const body = {
      merchant_id: this.merchantId,
      amount: Number(amount),
      currency: currency || 'IRT',
      description: String(description || 'اشتراک PRO'),
      callback_url: callbackUrl,
      metadata: {}
    };
    if (mobile) body.metadata.mobile = String(mobile);
    if (email) body.metadata.email = String(email);

    const res = await this.#postJson(`${this.apiBase}/pg/v4/payment/request.json`, body);
    const code = res?.data?.code;
    const authority = res?.data?.authority;
    if (code !== 100 || !authority) {
      const msg = res?.errors?.message || res?.data?.message || 'خطا در ایجاد درخواست پرداخت زرین‌پال';
      throw new AppError(msg, 502, { code: 'ZARINPAL_REQUEST_FAILED', zarinpalCode: code });
    }
    return {
      authority: String(authority),
      paymentUrl: this.startPayBase + authority,
      rawCode: code
    };
  }

  async verifyPayment({ amount, currency = 'IRT', authority }) {
    const body = {
      merchant_id: this.merchantId,
      amount: Number(amount),
      authority: String(authority)
    };
    // currency not required on verify per official guide; amount must match request
    const res = await this.#postJson(`${this.apiBase}/pg/v4/payment/verify.json`, body);
    const code = Number(res?.data?.code);
    if (code === 100) {
      return {
        ok: true,
        alreadyVerified: false,
        refId: res.data.ref_id,
        cardPan: res.data.card_pan || null,
        code,
        message: res.data.message || 'Verified'
      };
    }
    if (code === 101) {
      return {
        ok: true,
        alreadyVerified: true,
        refId: res.data.ref_id,
        cardPan: res.data.card_pan || null,
        code,
        message: res.data.message || 'Already verified'
      };
    }
    return {
      ok: false,
      code,
      message: res?.errors?.message || res?.data?.message || 'Verify failed',
      refId: null,
      cardPan: null
    };
  }

  #postJson(urlStr, payload) {
    return new Promise((resolve, reject) => {
      let parsed;
      try {
        parsed = new URL(urlStr);
      } catch (err) {
        return reject(err);
      }
      // Never log merchant_id / full payload
      const data = JSON.stringify(payload);
      const req = https.request(
        {
          protocol: parsed.protocol,
          hostname: parsed.hostname,
          port: parsed.port || 443,
          path: parsed.pathname + parsed.search,
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(data)
          },
          timeout: 25000
        },
        (res) => {
          let raw = '';
          res.on('data', (c) => { raw += c; });
          res.on('end', () => {
            try {
              resolve(raw ? JSON.parse(raw) : {});
            } catch (err) {
              safeLog('[zarinpal] invalid JSON response');
              reject(new AppError('پاسخ نامعتبر از درگاه پرداخت', 502));
            }
          });
        }
      );
      req.on('timeout', () => {
        req.destroy();
        reject(new AppError('زمان اتصال به درگاه پرداخت به پایان رسید', 504));
      });
      req.on('error', (err) => {
        safeLog('[zarinpal] network error', err && err.message);
        reject(new AppError('خطا در ارتباط با درگاه پرداخت', 502));
      });
      req.write(data);
      req.end();
    });
  }
}

module.exports = { ZarinPalProvider };
