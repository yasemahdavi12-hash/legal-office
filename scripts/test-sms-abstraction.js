/**
 * SMS abstraction — OTP/invitation delivery, logging, invitation URL, token security.
 */
require('dotenv').config();
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.OTP_TEST_FIXED = '654321';

const crypto = require('crypto');
const http = require('http');
const bcrypt = require('bcryptjs');
const db = require('../src/db/connection');
const { createApp } = require('../src/app');
const {
  SmsProviderInterface,
  normalizeSmsResult,
  NullSmsProvider
} = require('../src/services/sms/SmsProviderInterface');
const {
  setSmsProvider,
  isSmsDeliveryConfigured,
  resetSmsProviderForTests
} = require('../src/services/sms');
const tokenService = require('../src/services/clientInvitationToken.service');
const { sendClientInvitation } = require('../src/services/clientInvitationNotification.service');
const { resetRateLimitStoreForTests, MemoryRateLimitStore } = require('../src/middleware/rateLimitStore');
const { toDbDateTime, insertReturningId } = require('../src/utils/dbHelpers');

resetRateLimitStoreForTests(new MemoryRateLimitStore());

const results = [];
function assert(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

class MockConfiguredSmsProvider extends SmsProviderInterface {
  constructor(behavior = {}) {
    super();
    this.behavior = behavior;
    this.lastOtp = null;
    this.lastInvitation = null;
  }

  isDeliveryConfigured() {
    return true;
  }

  providerId() {
    return 'mock';
  }

  async sendOtp(payload) {
    this.lastOtp = payload;
    if (this.behavior.otpFail) {
      return { ok: false, provider: 'mock', reason: 'gateway_error' };
    }
    return { ok: true, provider: 'mock', queued: true };
  }

  async sendInvitation(payload) {
    this.lastInvitation = payload;
    if (this.behavior.inviteFail) {
      return { ok: false, provider: 'mock', reason: 'gateway_error' };
    }
    return { ok: true, provider: 'mock', queued: true };
  }
}

function req(port, method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : JSON.stringify(body);
    const r = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
          ...headers
        }
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => { raw += c; });
        res.on('end', () => {
          let json = null;
          try { json = raw ? JSON.parse(raw) : null; } catch { json = { raw }; }
          resolve({ status: res.statusCode, body: json });
        });
      }
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function main() {
  await db.migrate.latest();
  console.log('\nSMS abstraction tests\n');

  resetSmsProviderForTests(new NullSmsProvider());
  assert('Null not configured', !isSmsDeliveryConfigured());

  const nullInvite = await sendClientInvitation({
    client: { phone: '09121111111', name: 'تست' },
    lawyerName: 'وکیل',
    invitationUrl: 'http://localhost:3000/portal/invite/abc'
  });
  assert('invitation unconfigured → not sent', nullInvite.ok === false && nullInvite.status === 'not_configured');

  const mockOk = new MockConfiguredSmsProvider();
  setSmsProvider(mockOk);
  assert('mock configured', isSmsDeliveryConfigured());

  const okInvite = await sendClientInvitation({
    client: { phone: '09122222222', name: 'تست' },
    lawyerName: 'وکیل',
    invitationUrl: 'https://example.com/portal/invite/xyz'
  });
  assert('invitation provider success', okInvite.ok === true && okInvite.status === 'sent');
  assert('invitation message contains URL', mockOk.lastInvitation?.message?.includes('example.com'));

  setSmsProvider(new MockConfiguredSmsProvider({ inviteFail: true }));
  const failInvite = await sendClientInvitation({
    client: { phone: '09123333333' },
    lawyerName: 'وکیل',
    invitationUrl: 'https://example.com/portal/invite/bad'
  });
  assert('invitation provider failure', failInvite.ok === false && failInvite.status === 'provider_failed');

  const tag = `${Date.now()}.${crypto.randomBytes(2).toString('hex')}`;
  const email = `sms.otp.${tag}@test.local`;
  await db('users').insert({
    name: 'OTP User',
    email,
    password_hash: await bcrypt.hash('SmsOtpPass99!', 12),
    role: 'lawyer',
    token_version: 0,
    must_change_password: false,
    created_at: db.fn.now()
  });

  const mockOtp = new MockConfiguredSmsProvider();
  setSmsProvider(mockOtp);
  const server = createApp().listen(0);
  const PORT = server.address().port;

  const logLines = [];
  const origInfo = console.info;
  console.info = (...args) => logLines.push(args.join(' '));

  const forgot = await req(PORT, 'POST', '/api/auth/forgot-password', { email });
  assert('OTP provider success forgot', forgot.status === 200);
  assert('OTP passed to provider', mockOtp.lastOtp?.code === '654321');

  console.info = origInfo;
  const logBlob = logLines.join('\n');
  assert('OTP not in console logs', !logBlob.includes('654321'));
  assert('API key pattern not in logs', !/api[_-]?key\s*[:=]/i.test(logBlob));

  setSmsProvider(new MockConfiguredSmsProvider({ otpFail: true }));
  const forgotFail = await req(PORT, 'POST', '/api/auth/forgot-password', { email });
  assert('forgot still 200 when gateway fails', forgotFail.status === 200);

  server.close();

  const prevUrl = process.env.APP_PUBLIC_URL;
  process.env.APP_PUBLIC_URL = 'https://example.com';
  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/services/clientInvitationToken.service')];
  const tsUrl = require('../src/services/clientInvitationToken.service');
  const rawTok = tsUrl.generateRawInvitationToken();
  const url = tsUrl.buildInvitationUrl(rawTok);
  assert(
    'APP_PUBLIC_URL in invitation link',
    url === `https://example.com/portal/invite/${encodeURIComponent(rawTok)}`
  );
  process.env.APP_PUBLIC_URL = prevUrl;

  const [uid] = await db('users').insert({
    name: 'Law SMS',
    email: `law.sms.${tag}@test.local`,
    password_hash: await bcrypt.hash('x', 10),
    role: 'lawyer',
    token_version: 0,
    created_at: db.fn.now()
  });
  const [caseId] = await db('cases').insert({
    owner_id: uid,
    case_number: `SMS-${tag}`,
    title: 't',
    status: 'active',
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });
  const [clientId] = await db('clients').insert({
    owner_id: uid,
    case_id: caseId,
    name: 'C',
    phone: '09124444444',
    created_at: db.fn.now()
  });
  const [accessId] = await db('case_client_access').insert({
    case_id: caseId,
    client_id: clientId,
    status: 'pending',
    invited_at: db.fn.now(),
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });

  const expRaw = tokenService.generateRawInvitationToken();
  await insertReturningId(db, 'client_invitation_tokens', {
    access_id: accessId,
    token_hash: tokenService.hashInvitationToken(expRaw),
    expires_at: toDbDateTime(new Date(Date.now() - 86400000)),
    created_at: db.fn.now()
  });
  const expStatus = await tokenService.getPublicInviteStatus(expRaw);
  assert('expired token status', expStatus.status === 'expired', `got ${expStatus.status}`);

  const { rawToken } = await tokenService.createInvitationTokenForAccess(accessId);
  const row = await db('client_invitation_tokens')
    .where({ access_id: accessId, token_hash: tokenService.hashInvitationToken(rawToken) })
    .first();
  assert('token hash in DB not raw', row.token_hash === tokenService.hashInvitationToken(rawToken));
  assert('token hash sha256 hex', row.token_hash.length === 64);

  await tokenService.markTokenUsed(row.id);
  const usedStatus = await tokenService.getPublicInviteStatus(rawToken);
  assert('one-time token used', usedStatus.status === 'used');

  assert('normalize failure shape', normalizeSmsResult(null).ok === false && !!normalizeSmsResult(null).reason);

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n=== ${passed} passed / ${failed} failed / ${results.length} total ===\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
