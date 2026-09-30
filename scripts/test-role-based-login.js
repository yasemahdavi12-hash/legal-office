/**
 * Role-based login — shared POST /api/login, API access by role (no frontend role spoofing).
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../src/db/connection');
const { createApp } = require('../src/app');

let PORT = 0;
let server;
const results = [];

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
          resolve({ status: res.statusCode, body: json, headers: res.headers });
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
  server = createApp().listen(0);
  PORT = server.address().port;
  console.log(`\nRole-based login tests → :${PORT}\n`);

  const tag = `${Date.now()}.${crypto.randomBytes(2).toString('hex')}`;
  const lawyerPass = 'LawyerPass99!';
  const clientPass = 'ClientPass99!';
  const adminPass = 'AdminRolePass99!';

  const lawyerReg = await req('POST', '/api/register', {
    name: 'وکیل RB',
    email: `law.rb.${tag}@test.local`,
    password: lawyerPass,
    role: 'lawyer'
  });
  assert('lawyer register', lawyerReg.status === 201 || lawyerReg.status === 200, `status ${lawyerReg.status}`);

  const lawyerLogin = await req('POST', '/api/login', {
    email: `law.rb.${tag}@test.local`,
    password: lawyerPass
  });
  const lawyerToken = lawyerLogin.body?.accessToken || lawyerLogin.body?.token;
  assert(
    'lawyer login → role lawyer',
    lawyerLogin.status === 200 && lawyerLogin.body?.user?.role === 'lawyer',
    `role=${lawyerLogin.body?.user?.role}`
  );

  const caseRes = await req('POST', '/api/cases', {
    case_number: `RB-${tag}`,
    title: 'پرونده RB'
  }, auth(lawyerToken));
  const caseId = caseRes.body?.id;
  assert('lawyer creates case', !!caseId);

  const lawyerCases = await req('GET', '/api/cases', null, auth(lawyerToken));
  assert(
    'lawyer panel: list cases',
    lawyerCases.status === 200 && Array.isArray(lawyerCases.body) && lawyerCases.body.some((c) => c.id === caseId),
    `status ${lawyerCases.status}`
  );

  const adminEmail = `admin.rb.${tag}@test.local`;
  await db('users').insert({
    name: 'Admin RB',
    email: adminEmail,
    password_hash: await bcrypt.hash(adminPass, 12),
    role: 'admin',
    token_version: 0,
    must_change_password: false,
    mfa_enabled: false,
    created_at: db.fn.now()
  });

  const adminLogin = await req('POST', '/api/login', { email: adminEmail, password: adminPass });
  const adminToken = adminLogin.body?.accessToken || adminLogin.body?.token;
  assert(
    'admin login → role admin',
    adminLogin.status === 200 && adminLogin.body?.user?.role === 'admin',
    `role=${adminLogin.body?.user?.role}`
  );

  const adminUsers = await req('GET', '/api/admin/users', null, auth(adminToken));
  assert('admin panel: list users', adminUsers.status === 200 && Array.isArray(adminUsers.body), `status ${adminUsers.status}`);

  const phone = '09125551234';
  await req('POST', '/api/clients', { name: 'موکل RB', phone, case_id: caseId }, auth(lawyerToken));

  const clientReg = await req('POST', '/api/portal/register', {
    name: 'موکل RB',
    email: `client.rb.${tag}@test.local`,
    password: clientPass,
    phone
  });
  assert(
    'client register',
    clientReg.status === 201 && clientReg.body?.user?.role === 'client',
    `status ${clientReg.status}`
  );

  const clientLogin = await req('POST', '/api/login', {
    email: `client.rb.${tag}@test.local`,
    password: clientPass
  });
  const clientToken = clientLogin.body?.accessToken || clientLogin.body?.token;
  assert(
    'client shared login → role client',
    clientLogin.status === 200 && clientLogin.body?.user?.role === 'client',
    `role=${clientLogin.body?.user?.role}`
  );

  const portalCases = await req('GET', '/api/portal/cases', null, auth(clientToken));
  assert('client portal API reachable', portalCases.status === 200 && Array.isArray(portalCases.body), `status ${portalCases.status}`);

  const lawyerOnPortal = await req('GET', '/api/portal/cases', null, auth(lawyerToken));
  assert('lawyer cannot read portal cases', lawyerOnPortal.status === 403, `status ${lawyerOnPortal.status}`);

  const clientOnLawyerCase = await req('GET', `/api/cases/${caseId}`, null, auth(clientToken));
  assert(
    'client cannot read lawyer case detail',
    clientOnLawyerCase.status === 404,
    `status ${clientOnLawyerCase.status}`
  );

  const loginPage = await req('GET', '/login', null, {});
  assert('shared login page served', loginPage.status === 200, `status ${loginPage.status}`);

  const lawyerRegHome = await req('GET', '/?lawyer_register=1');
  const lawyerRegHtml = lawyerRegHome.body?.raw || '';
  assert(
    'lawyer_register URL serves lawyer registration UI',
    lawyerRegHome.status === 200
      && lawyerRegHtml.includes('id="register-form"')
      && lawyerRegHtml.includes('ثبت‌نام وکیل'),
    `status ${lawyerRegHome.status}`
  );
  const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert(
    'lawyer_register with client session must not auto-redirect to portal',
    indexSrc.includes('function showLawyerRegisterGate')
      && /if \(lawyerRegisterIntent\) \{\s*showLawyerRegisterGate\(\);\s*return;\s*\}\s*if \(redirectIfNonLawyerPanel/.test(indexSrc),
    'index bootstrap guard missing'
  );

  const spoofRole = await req('POST', '/api/login', {
    email: `client.rb.${tag}@test.local`,
    password: clientPass,
    role: 'admin'
  });
  assert(
    'login ignores body.role (JWT role from DB)',
    spoofRole.status === 200 && spoofRole.body?.user?.role === 'client',
    `role=${spoofRole.body?.user?.role}`
  );

  const regAdminHack = await req('POST', '/api/register', {
    name: 'hack',
    email: `hack.admin.${tag}@test.local`,
    password: 'LawyerPass99!',
    role: 'admin'
  });
  assert(
    'public register cannot create admin',
    regAdminHack.status === 400
      || ((regAdminHack.status === 201 || regAdminHack.status === 200) && regAdminHack.body?.user?.role === 'lawyer'),
    `status ${regAdminHack.status} role ${regAdminHack.body?.user?.role}`
  );

  const clientAdminApi = await req('GET', '/api/admin/users', null, auth(clientToken));
  assert('client cannot access admin API', clientAdminApi.status === 403, `status ${clientAdminApi.status}`);

  const adminPortalApi = await req('GET', '/api/portal/cases', null, auth(adminToken));
  assert('admin cannot access portal cases API', adminPortalApi.status === 403, `status ${adminPortalApi.status}`);

  const lawyerAdminApi = await req('GET', '/api/admin/users', null, auth(lawyerToken));
  assert('lawyer cannot access admin API', lawyerAdminApi.status === 403, `status ${lawyerAdminApi.status}`);

  assert('lawyer login home role', lawyerLogin.body?.user?.role === 'lawyer');
  assert('client login home role', clientLogin.body?.user?.role === 'client');
  assert('admin login home role', adminLogin.body?.user?.role === 'admin');

  try {
    const uids = [
      lawyerReg.body?.user?.id,
      clientReg.body?.user?.id,
      adminLogin.body?.user?.id
    ].filter(Boolean);
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
