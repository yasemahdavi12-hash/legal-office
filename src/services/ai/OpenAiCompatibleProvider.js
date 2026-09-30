const { AiProviderInterface } = require('./AiProviderInterface');

/**
 * OpenAI Chat Completions–compatible HTTP provider.
 * API key never logged; only used in Authorization header.
 */
class OpenAiCompatibleProvider extends AiProviderInterface {
  constructor({ apiKey, baseUrl, model }) {
    super();
    this.apiKey = apiKey;
    this.baseUrl = String(baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
    this.model = model || 'gpt-4o-mini';
  }

  async chat({ system, user, maxTokens }) {
    const url = `${this.baseUrl}/chat/completions`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        max_tokens: maxTokens,
        temperature: 0.3
      })
    });

    const raw = await res.text();
    let data = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = null;
    }

    if (!res.ok) {
      const err = new Error('AI_PROVIDER_HTTP_ERROR');
      err.status = 502;
      err.providerStatus = res.status;
      // Do not attach raw body (may echo secrets); keep short code only
      err.code = (data && data.error && data.error.code) || 'PROVIDER_ERROR';
      throw err;
    }

    const text =
      data?.choices?.[0]?.message?.content ||
      data?.choices?.[0]?.text ||
      '';
    if (!String(text).trim()) {
      const err = new Error('AI_PROVIDER_EMPTY');
      err.status = 502;
      throw err;
    }
    return { text: String(text).trim() };
  }
}

module.exports = { OpenAiCompatibleProvider };
