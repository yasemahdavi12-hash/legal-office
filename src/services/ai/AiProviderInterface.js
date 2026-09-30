/**
 * AI chat provider abstraction — swap vendors without changing callers.
 */
class AiProviderInterface {
  /**
   * @param {{ system: string, user: string, maxTokens: number }} _payload
   * @returns {Promise<{ text: string }>}
   */
  async chat(_payload) {
    throw new Error('chat() must be implemented');
  }
}

module.exports = { AiProviderInterface };
