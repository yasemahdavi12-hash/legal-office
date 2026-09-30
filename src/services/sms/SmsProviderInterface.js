/**
 * SMS / OTP delivery abstraction.
 * See SMS_PROVIDER_CONTRACT.md for adapter requirements.
 *
 * Implementations MUST NOT log OTP/code, API keys, or full message bodies containing secrets.
 */

/**
 * @typedef {object} SmsSendResult
 * @property {boolean} ok
 * @property {string} [provider] - short id e.g. 'null', 'none', or your gateway id
 * @property {string} [reason] - machine-readable when ok=false
 * @property {boolean} [queued] - true when handed off to gateway queue
 */

/**
 * @param {SmsSendResult|undefined|null} result
 * @returns {SmsSendResult}
 */
function normalizeSmsResult(result) {
  if (!result || typeof result !== 'object') {
    return { ok: false, provider: 'unknown', reason: 'invalid_provider_response' };
  }
  const ok = result.ok === true;
  const out = {
    ok,
    provider: String(result.provider || 'unknown').slice(0, 64)
  };
  if (!ok && result.reason) out.reason = String(result.reason).slice(0, 128);
  if (result.queued === true) out.queued = true;
  return out;
}

class SmsProviderInterface {
  /**
   * True when a real gateway adapter is registered (production-ready delivery).
   * Development Null provider returns false.
   */
  isDeliveryConfigured() {
    return false;
  }

  /**
   * Short stable id for logs/metrics (never secrets).
   * @returns {string}
   */
  providerId() {
    return 'base';
  }

  /**
   * @param {{ to: string, template: string, code?: string, meta?: object }} _payload
   * @returns {Promise<SmsSendResult>}
   */
  async sendOtp(_payload) {
    throw new Error('sendOtp() must be implemented');
  }

  /**
   * @param {{ to: string, message: string, meta?: object }} _payload
   * @returns {Promise<SmsSendResult>}
   */
  async sendInvitation(_payload) {
    throw new Error('sendInvitation() must be implemented');
  }
}

/**
 * Development-only: simulates OTP queue success without network.
 * Does NOT count as configured delivery (invitations report not sent).
 */
class NullSmsProvider extends SmsProviderInterface {
  isDeliveryConfigured() {
    return false;
  }

  providerId() {
    return 'null';
  }

  async sendOtp({ to, template }) {
    if (!to || !template) {
      return { ok: false, provider: 'null', reason: 'invalid_payload' };
    }
    return { ok: true, provider: 'null', queued: true };
  }

  async sendInvitation({ to, message }) {
    if (!to || !message) {
      return { ok: false, provider: 'null', reason: 'invalid_payload' };
    }
    return { ok: true, provider: 'null', queued: true };
  }
}

/**
 * Production default when no gateway adapter is registered via setSmsProvider().
 */
class UnconfiguredSmsProvider extends SmsProviderInterface {
  isDeliveryConfigured() {
    return false;
  }

  providerId() {
    return 'none';
  }

  async sendOtp() {
    return { ok: false, provider: 'none', reason: 'sms_not_configured' };
  }

  async sendInvitation() {
    return { ok: false, provider: 'none', reason: 'sms_not_configured' };
  }
}

module.exports = {
  SmsProviderInterface,
  NullSmsProvider,
  UnconfiguredSmsProvider,
  normalizeSmsResult
};
