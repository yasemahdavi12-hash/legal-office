const config = require('../../config');
const { OpenAiCompatibleProvider } = require('./OpenAiCompatibleProvider');

let provider = undefined; // undefined = use default; null = explicitly disabled (tests)

function isAiConfigured() {
  const a = config.ai || {};
  return !!(a.enabled && a.apiKey);
}

function createDefaultProvider() {
  if (!isAiConfigured()) return null;
  return new OpenAiCompatibleProvider({
    apiKey: config.ai.apiKey,
    baseUrl: config.ai.baseUrl,
    model: config.ai.model
  });
}

function getAiProvider() {
  if (provider !== undefined) return provider;
  return createDefaultProvider();
}

/** Swap provider (tests / alternate vendors). Pass null to force disabled. */
function setAiProvider(next) {
  if (next != null && typeof next.chat !== 'function') {
    throw new Error('Invalid AI provider');
  }
  provider = next;
}

function resetAiProvider() {
  provider = undefined;
}

module.exports = {
  getAiProvider,
  setAiProvider,
  resetAiProvider,
  isAiConfigured
};
