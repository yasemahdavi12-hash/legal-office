# SMS provider adapter contract

This app delivers OTP (password reset) and client invitation links via a pluggable SMS provider.
**No gateway is bundled.** Register your adapter at process startup with `setSmsProvider()`.

## Registration

```javascript
const { setSmsProvider } = require('./services/sms');
setSmsProvider(new YourGatewayAdapter(/* reads its own env */));
```

Call once before handling traffic (e.g. in `server.js` after `dotenv`).

## Class requirements

Extend `SmsProviderInterface` (`SmsProviderInterface.js`) and implement:

| Method | Purpose |
|--------|---------|
| `isDeliveryConfigured()` | Return `true` only when the gateway is fully configured and can send. |
| `providerId()` | Short id for logs (e.g. `'kavenegar'`). Never return API keys. |
| `sendOtp({ to, template, code, meta })` | Deliver OTP for `password_reset_otp` and similar templates. |
| `sendInvitation({ to, message, meta })` | Deliver full invitation text (includes public URL). |

## Response shape

Every send method must return:

```javascript
// success
{ ok: true, provider: '<your-id>', queued: true }

// failure
{ ok: false, provider: '<your-id>', reason: 'short_snake_case' }
```

Use `normalizeSmsResult()` if you wrap external APIs.

## Security rules (mandatory)

- Never `console.log` / log the `code` (OTP) field.
- Never log API keys, tokens, or gateway secrets.
- Do not include OTP in thrown errors or HTTP responses.
- Invitation `message` may contain the public link; do not log full message in production unless redacted.

## Runtime behavior

| Environment | Default provider | Password reset | Invitation SMS flag |
|-------------|------------------|----------------|---------------------|
| development | `NullSmsProvider` | OTP queued (use `OTP_TEST_FIXED` in tests) | `invitationSent: false` until adapter configured |
| production | `UnconfiguredSmsProvider` until `setSmsProvider` | `503 SMS_NOT_CONFIGURED` if not configured | `invitationSent: false`, access/token still created |

## Invitation URLs

Built with `APP_PUBLIC_URL` (see `clientInvitationToken.service.js` → `buildInvitationUrl`).
Production requires `APP_PUBLIC_URL` to be set and use `https://`.

## What we need from you to implement an adapter

1. Gateway product name and API style (REST/SOAP/SDK).
2. Authentication (API key header, basic auth, etc.) — **env var names you prefer** (we will not guess).
3. Send SMS endpoint or SDK method signature.
4. Phone number format (E.164, national, leading zero).
5. Whether OTP and long SMS (invitation body) use the same API or different templates.
6. Error codes / rate limits to map to `reason` strings.
7. Sandbox vs production base URL.

No gateway-specific env vars are defined in this repo until you choose a provider.
