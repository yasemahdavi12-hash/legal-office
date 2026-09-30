const { ZarinPalProvider } = require('./ZarinPalProvider');
const config = require('../../config');

let provider = null;

function createDefaultProvider() {
  const z = config.zarinpal;
  if (!z || !z.merchantId) {
    return null;
  }
  return new ZarinPalProvider({
    merchantId: z.merchantId,
    sandbox: z.sandbox
  });
}

function getPaymentProvider() {
  if (provider) return provider;
  provider = createDefaultProvider();
  return provider;
}

/** Swap provider (tests / alternate gateways). */
function setPaymentProvider(next) {
  if (next != null && typeof next.requestPayment !== 'function') {
    throw new Error('Invalid payment provider');
  }
  provider = next;
}

function resetPaymentProvider() {
  provider = null;
}

module.exports = { getPaymentProvider, setPaymentProvider, resetPaymentProvider };
