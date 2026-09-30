function safeLog(...args) {
  const cleaned = args.map((arg) => {
    if (typeof arg === 'string') {
      return arg
        .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]')
        .replace(/("?(?:password|token|accessToken|refreshToken|authorization|resetToken|reset_token|otp|code|merchant_id|merchantId)"?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;}]+)/gi, '$1[REDACTED]');
    }
    if (arg && typeof arg === 'object') {
      try {
        const clone = JSON.parse(JSON.stringify(arg));
        const redactKeys = [
          'password', 'newPassword', 'new_password', 'token', 'accessToken', 'refreshToken',
          'authorization', 'password_hash', 'resetToken', 'reset_token', 'otp', 'code', 'otp_hash',
          'merchant_id', 'merchantId', 'card_pan', 'card_hash', 'authority',
          'p256dh', 'auth', 'privateKey', 'VAPID_PRIVATE_KEY',
          'mfaToken', 'mfa_token', 'mfa_secret_enc', 'secret', 'recoveryCodes', 'recovery_codes',
          'BACKUP_ENCRYPTION_KEY', 'MFA_ENCRYPTION_KEY', 'S3_SECRET_ACCESS_KEY',
          'apiKey', 'AI_API_KEY', 'ai_api_key',
          'invitationToken', 'invitationUrl', 'rawToken'
        ];
        (function walk(o) {
          if (!o || typeof o !== 'object') return;
          for (const k of Object.keys(o)) {
            if (redactKeys.includes(k) || /^(otp|password|token|secret|merchant|vapid|mfa|recovery|api[_-]?key)/i.test(k)) {
              o[k] = '[REDACTED]';
            } else walk(o[k]);
          }
        })(clone);
        return clone;
      } catch {
        return '[unserializable]';
      }
    }
    return arg;
  });
  console.error(...cleaned);
}

module.exports = { safeLog };
