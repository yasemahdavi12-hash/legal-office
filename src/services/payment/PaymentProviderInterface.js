/**
 * Payment provider abstraction — swap gateways without changing callers.
 * Implementations must NEVER log merchant secrets or full card data.
 */
class PaymentProviderInterface {
  /**
   * @param {{ amount: number, currency: string, description: string, callbackUrl: string, email?: string, mobile?: string, metadata?: object }} _payload
   * @returns {Promise<{ authority: string, paymentUrl: string, rawCode?: number }>}
   */
  async requestPayment(_payload) {
    throw new Error('requestPayment() must be implemented');
  }

  /**
   * @param {{ amount: number, currency: string, authority: string }} _payload
   * @returns {Promise<{ ok: boolean, alreadyVerified?: boolean, refId?: string|number, cardPan?: string, code: number, message?: string }>}
   */
  async verifyPayment(_payload) {
    throw new Error('verifyPayment() must be implemented');
  }
}

module.exports = { PaymentProviderInterface };
