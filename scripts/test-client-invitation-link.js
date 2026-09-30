/**
 * Client invitation link — token, URL, accept, security, race.
 */
require('dotenv').config();
const http = require('http');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../src/db/connection');
const { createApp } = require('../src/app');
const { toDbDateTime } = require('../src/utils/dbHelpers');
const { SmsProviderInterface } = require('../src/services/sms/SmsProviderInterface');
const { setSmsProvider } = require('../src/services/sms');

class TestConfiguredSmsProvider extends SmsProviderInterface {
  isDeliveryConfigured() {
    return true;
  }
  providerId() {
    return 'test';
  }
  async sendOtp() {
    return { ok: true, provider: 'test', queued: true };
  }
  async sendInvitation() {
    return { ok: true, provider: 'test', queued: true };
  }
}

let PORT = 0;
let server;
const results = [];
const PHONE = '09126667788';

function req(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : JSON.stringify(body);
    const r = http.request(
      {
        hostname: '127.0.0.1',
        port: PORT,
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

function assert(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

function auth(token) {
  return { Authorization: 'Bearer ' + token };
}

async function main() {
  await db.migrate.latest();
  setSmsProvider(new TestConfiguredSmsProvider());
  server = createApp().listen(0);
  PORT = server.address().port;
  console.log(`\nClient invitation link tests → :${PORT}\n`);

  const tag = `${Date.now()}.${crypto.randomBytes(2).toString('hex')}`;

  const lawyerReg = await req('POST', '/api/register', {
    name: 'وکیل دعوت',
    email: `law.inv.${tag}@test.local`,
    password: 'LawyerPass99!',
    role: 'lawyer'
  });
  const lawyerToken = lawyerReg.body.accessToken || lawyerReg.body.token;
  assert('lawyer register', !!lawyerToken);

  const caseRes = await req('POST', '/api/cases', {
    case_number: `INV-${tag}`,
    title: 'پرونده دعوت'
  }, auth(lawyerToken));
  const caseId = caseRes.body?.id;
  assert('case created', !!caseId);

  const clientCrm = await req('POST', '/api/clients', {
    name: 'موکل لینک',
    phone: PHONE,
    case_id: caseId
  }, auth(lawyerToken));
  assert('CRM client', clientCrm.status === 201 && clientCrm.body?.id);

  const invite = await req(
    'POST',
    `/api/cases/${caseId}/client-access/invite`,
    { clientId: clientCrm.body.id },
    auth(lawyerToken)
  );
  assert('lawyer creates invitation', invite.status === 201 && invite.body?.status === 'pending');
  assert('token generated', !!invite.body?.invitationToken, 'missing invitationToken');
  assert('invitation URL generated', !!invite.body?.invitationUrl && invite.body.invitationUrl.includes('/portal/invite/'));
  assert('invitation sent flag', invite.body?.invitationSent === true);

  const rawToken = invite.body.invitationToken;
  const accessId = invite.body.id;

  const preview = await req('GET', `/api/portal/invite/${encodeURIComponent(rawToken)}`);
  assert('valid token preview', preview.status === 200 && preview.body?.status === 'valid');

  const fake = crypto.randomBytes(32).toString('base64url');
  const fakePreview = await req('GET', `/api/portal/invite/${encodeURIComponent(fake)}`);
  assert('random token rejected', fakePreview.status === 200 && fakePreview.body?.status === 'invalid');

  const clientReg = await req('POST', '/api/portal/register', {
    name: 'موکل لینک',
    email: `client.inv.${tag}@test.local`,
    password: 'ClientPass99!',
    phone: PHONE
  });
  const clientToken = clientReg.body.accessToken || clientReg.body.token;
  assert('client registration through portal', clientReg.status === 201 && clientReg.body?.user?.role === 'client');

  const accept = await req(
    'POST',
    `/api/portal/invite/${encodeURIComponent(rawToken)}/accept`,
    {},
    auth(clientToken)
  );
  assert('valid token accepted by correct client', accept.status === 200 && accept.body?.status === 'active');

  const linked = await db('clients').where({ id: clientCrm.body.id }).first();
  assert('client.user_id linked after accept', linked && linked.user_id === clientReg.body.user.id);

  const usedPreview = await req('GET', `/api/portal/invite/${encodeURIComponent(rawToken)}`);
  assert('used token preview', usedPreview.body?.status === 'used');

  const usedAccept = await req(
    'POST',
    `/api/portal/invite/${encodeURIComponent(rawToken)}/accept`,
    {},
    auth(clientToken)
  );
  assert('used token rejected on accept', usedAccept.status === 404 || usedAccept.status === 410, `status ${usedAccept.status}`);

  const cases = await req('GET', '/api/portal/cases', null, auth(clientToken));
  assert('client sees case after accept', cases.status === 200 && cases.body.some((c) => c.id === caseId));

  const lawyerAccept = await req(
    'POST',
    `/api/portal/invite/${encodeURIComponent(rawToken)}/accept`,
    {},
    auth(lawyerToken)
  );
  assert('lawyer rejected', lawyerAccept.status === 403, `status ${lawyerAccept.status}`);

  const adminEmail = `admin.inv.${tag}@test.local`;
  await db('users').insert({
    name: 'Admin',
    email: adminEmail,
    password_hash: await bcrypt.hash('AdminPass99!', 12),
    role: 'admin',
    token_version: 0,
    must_change_password: false,
    mfa_enabled: false,
    created_at: db.fn.now()
  });
  const adminLogin = await req('POST', '/api/login', { email: adminEmail, password: 'AdminPass99!' });
  const adminToken = adminLogin.body.accessToken;
  const adminAccept = await req(
    'POST',
    `/api/portal/invite/${encodeURIComponent(rawToken)}/accept`,
    {},
    auth(adminToken)
  );
  assert('admin rejected', adminAccept.status === 403, `status ${adminAccept.status}`);

  const lawyerPortal = await req('GET', '/api/portal/cases', null, auth(lawyerToken));
  assert('lawyer cannot read portal cases', lawyerPortal.status === 403);

  const case2 = await req('POST', '/api/cases', { case_number: `INV2-${tag}`, title: '2' }, auth(lawyerToken));
  const crm2 = await req('POST', '/api/clients', { name: 'B', phone: '09128889999', case_id: case2.body.id }, auth(lawyerToken));
  const inv2 = await req('POST', `/api/cases/${case2.body.id}/client-access/invite`, { clientId: crm2.body.id }, auth(lawyerToken));
  const tok2 = inv2.body.invitationToken;
  await db('client_invitation_tokens')
    .where({ access_id: inv2.body.id })
    .update({ expires_at: toDbDateTime(new Date(Date.now() - 3600000)) });
  const expiredPreview = await req('GET', `/api/portal/invite/${encodeURIComponent(tok2)}`);
  assert('expired token rejected', expiredPreview.body?.status === 'expired');
  const otherReg = await req('POST', '/api/portal/register', {
    name: 'Other',
    email: `other.inv.${tag}@test.local`,
    password: 'ClientPass99!',
    phone: '09128889999'
  });
  const expiredAccept = await req(
    'POST',
    `/api/portal/invite/${encodeURIComponent(tok2)}/accept`,
    {},
    auth(otherReg.body.accessToken)
  );
  assert('expired token accept blocked', expiredAccept.status === 410 || expiredAccept.status === 404, `status ${expiredAccept.status}`);

  const case3 = await req('POST', '/api/cases', { case_number: `INV3-${tag}`, title: '3' }, auth(lawyerToken));
  const crm3 = await req('POST', '/api/clients', { name: 'C', phone: '09127776666', case_id: case3.body.id }, auth(lawyerToken));
  const inv3 = await req('POST', `/api/cases/${case3.body.id}/client-access/invite`, { clientId: crm3.body.id }, auth(lawyerToken));
  const tok3 = inv3.body.invitationToken;
  await req('DELETE', `/api/cases/${case3.body.id}/client-access/${inv3.body.id}`, null, auth(lawyerToken));
  const revokedPreview = await req('GET', `/api/portal/invite/${encodeURIComponent(tok3)}`);
  assert('revoked token rejected', revokedPreview.body?.status === 'revoked');

  const case4 = await req('POST', '/api/cases', { case_number: `INV4-${tag}`, title: '4' }, auth(lawyerToken));
  const crm4 = await req('POST', '/api/clients', { name: 'D', phone: '09124445555', case_id: case4.body.id }, auth(lawyerToken));
  const inv4 = await req('POST', `/api/cases/${case4.body.id}/client-access/invite`, { clientId: crm4.body.id }, auth(lawyerToken));
  const tok4 = inv4.body.invitationToken;
  const u4 = await req('POST', '/api/portal/register', {
    name: 'D user',
    email: `d.inv.${tag}@test.local`,
    password: 'ClientPass99!',
    phone: '09124445555'
  });
  const wrongClient = await req('POST', '/api/portal/register', {
    name: 'Wrong',
    email: `wrong.inv.${tag}@test.local`,
    password: 'ClientPass99!',
    phone: '09123334444'
  });
  const wrongAccept = await req(
    'POST',
    `/api/portal/invite/${encodeURIComponent(tok4)}/accept`,
    {},
    auth(wrongClient.body.accessToken)
  );
  assert('wrong client rejected', wrongAccept.status === 404, `status ${wrongAccept.status}`);

  const case5 = await req('POST', '/api/cases', { case_number: `INV5-${tag}`, title: '5' }, auth(lawyerToken));
  const crm5 = await req('POST', '/api/clients', { name: 'Race', phone: '09121113333', case_id: case5.body.id }, auth(lawyerToken));
  const inv5 = await req('POST', `/api/cases/${case5.body.id}/client-access/invite`, { clientId: crm5.body.id }, auth(lawyerToken));
  const tok5 = inv5.body.invitationToken;
  const r1 = await req('POST', '/api/portal/register', {
    name: 'R1', email: `r1.inv.${tag}@test.local`, password: 'ClientPass99!', phone: '09121113333'
  });
  const r2 = await req('POST', '/api/portal/register', {
    name: 'R2', email: `r2.inv.${tag}@test.local`, password: 'ClientPass99!', phone: '09121113333'
  });
  const [c1, c2] = await Promise.all([
    req('POST', `/api/portal/invite/${encodeURIComponent(tok5)}/accept`, {}, auth(r1.body.accessToken)),
    req('POST', `/api/portal/invite/${encodeURIComponent(tok5)}/accept`, {}, auth(r2.body.accessToken))
  ]);
  const okCount = [c1, c2].filter((r) => r.status === 200).length;
  const failCount = [c1, c2].filter((r) => r.status === 404 || r.status === 409).length;
  assert('concurrent claim: one success', okCount === 1 && failCount === 1, `ok=${okCount} fail=${failCount}`);

  const existingLogin = await req('POST', '/api/login', {
    email: `client.inv.${tag}@test.local`,
    password: 'ClientPass99!'
  });
  assert('existing client login', existingLogin.status === 200 && existingLogin.body?.user?.role === 'client');

  const case6 = await req('POST', '/api/cases', { case_number: `INV6-${tag}`, title: '6' }, auth(lawyerToken));
  const crm6 = await req('POST', '/api/clients', { name: 'E', phone: PHONE, case_id: case6.body.id }, auth(lawyerToken));
  const inv6 = await req('POST', `/api/cases/${case6.body.id}/client-access/invite`, { clientId: crm6.body.id }, auth(lawyerToken));
  const tok6 = inv6.body.invitationToken;
  const acceptExisting = await req(
    'POST',
    `/api/portal/invite/${encodeURIComponent(tok6)}/accept`,
    {},
    auth(existingLogin.body.accessToken)
  );
  assert('existing client login + accept', acceptExisting.status === 200 && acceptExisting.body?.status === 'active');

  const crossCase = await req('GET', `/api/portal/cases/${case6.body.id}`, null, auth(wrongClient.body.accessToken));
  assert('unrelated client cannot see case', crossCase.status === 404);

  const invitePage = await req('GET', `/portal/invite/${encodeURIComponent(tok6)}`);
  assert('invite HTML page served', invitePage.status === 200);

  const idorAccess = await req(
    'POST',
    `/api/portal/client-access/99999999/accept`,
    {},
    auth(clientToken)
  );
  assert('accessId IDOR blocked', idorAccess.status === 404);

  try {
    const uids = [
      lawyerReg.body?.user?.id,
      clientReg.body?.user?.id,
      otherReg.body?.user?.id,
      u4.body?.user?.id,
      wrongClient.body?.user?.id,
      r1.body?.user?.id,
      r2.body?.user?.id
    ].filter(Boolean);
    await db('case_client_access').whereIn('case_id', [
      caseId, case2.body?.id, case3.body?.id, case4.body?.id, case5.body?.id, case6.body?.id
    ].filter(Boolean)).del();
    await db('clients').whereIn('owner_id', uids).del();
    await db('cases').whereIn('owner_id', uids).del();
    await db('refresh_tokens').whereIn('user_id', uids).del();
    await db('users').whereIn('id', uids).del();
    await db('users').where({ email: adminEmail }).del();
  } catch { /* ignore */ }

  await new Promise((r) => server.close(r));
  const failed = results.filter((x) => !x.ok);
  console.log(`\n=== ${results.length - failed.length} passed / ${failed.length} failed / ${results.length} total ===\n`);
  process.exit(failed.length ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  try { if (server) await new Promise((r) => server.close(r)); } catch { /* */ }
  process.exit(1);
});
