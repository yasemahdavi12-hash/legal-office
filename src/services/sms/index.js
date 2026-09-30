const {
  NullSmsProvider,
  UnconfiguredSmsProvider
} = require('./SmsProviderInterface');

function isProductionEnv() {
  return (process.env.NODE_ENV || 'development') === 'production';
}

function createDefaultSmsProvider() {
  if (isProductionEnv()) {
    return new UnconfiguredSmsProvider();
  }
  return new NullSmsProvider();
}

let provider = createDefaultSmsProvider();

function getSmsProvider() {
  return provider;
}

function isSmsDeliveryConfigured() {
  return typeof provider.isDeliveryConfigured === 'function' && provider.isDeliveryConfigured() === true;
}

/** Swap in a real gateway adapter (must implement sendOtp + sendInvitation). */
function setSmsProvider(next) {
  if (!next || typeof next.sendOtp !== 'function' || typeof next.sendInvitation !== 'function') {
    throw new Error('Invalid SMS provider: sendOtp and sendInvitation are required');
  }
  provider = next;
}

function resetSmsProviderForTests(next) {
  provider = next ?? createDefaultSmsProvider();
  return provider;
}

module.exports = {
  getSmsProvider,
  setSmsProvider,
  isSmsDeliveryConfigured,
  resetSmsProviderForTests,
  createDefaultSmsProvider
};
