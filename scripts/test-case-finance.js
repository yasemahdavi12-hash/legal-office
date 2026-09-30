/**
 * Case finance MVP — lawyer/client access, calculations, notifications, schema.
 */
require('dotenv').config();
const http = require('http');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../src/db/connection');
const { createApp } = require('../src/app');

let PORT = 0;
let server;
const results = [];

function req(method, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : JSON.stringify(body);
    const r = http.request(
      {
        hostname: '127.0.0.1',
        port: PORT,
        path: urlPath,
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

async function registerLawyer(tag) {
  const reg = await req('POST', '/api/register', {
    name: 'وکیل ' + tag,
    email: `law.fin.${tag}@test.local`,
    password: 'LawyerPass99!',
    role: 'lawyer'
  });
  return { token: reg.body.accessToken || reg.body.token, userId: reg.body.user?.id };
}

async function createClientUser(tag, phone) {
  const email = `client.fin.${tag}@test.local`;
  const password = 'ClientPass99!';
  const id = await db('users').insert({
    name: 'موکل ' + tag,
    email,
    phone,
    password_hash: await bcrypt.hash(password, 12),
    role: 'client',
    token_version: 0,
    must_change_password: false,
    created_at: db.fn.now()
  });
  const userId = Array.isArray(id) ? id[0] : id;
  const login = await req('POST', '/api/login', { email, password });
  return { userId, token: login.body.accessToken || login.body.token };
}

async function setupActiveClient(lawToken, caseId, phone, tag) {
  const clientRec = await req('POST', '/api/clients', {
    name: 'موکل ' + tag,
    phone,
    case_id: caseId
  }, auth(lawToken));
  const clientId = clientRec.body?.id;
  const user = await createClientUser(tag, phone);
  await db('clients').where({ id: clientId }).update({ user_id: user.userId });
  const inv = await req('POST', `/api/cases/${caseId}/client-access/invite`, { clientId }, auth(lawToken));
  await req('POST', `/api/portal/client-access/${inv.body.id}/accept`, {}, auth(user.token));
  return { clientId, ...user };
}

async function countNotifs(userId, type, caseId) {
  let q = db('notifications').where({ user_id: userId, type });
  if (caseId != null) q = q.where({ case_id: caseId });
  return Number((await q.count({ c: '*' }))[0]?.c || 0);
}

async function main() {
  await db.migrate.latest();
  server = createApp().listen(0);
  PORT = server.address().port;
  console.log(`\nCase finance tests → :${PORT}\n`);

  const hasFin = await db.schema.hasTable('case_financials');
  const hasPay = await db.schema.hasTable('case_payments');
  assert('schema case_financials exists', hasFin);
  assert('schema case_payments exists', hasPay);

  const tag = `${Date.now()}.${crypto.randomBytes(2).toString('hex')}`;
  const lawA = await registerLawyer(`a.${tag}`);
  const lawB = await registerLawyer(`b.${tag}`);
  const caseA = await req('POST', '/api/cases', { case_number: `FA-${tag}`, title: 'Finance A' }, auth(lawA.token));
  const caseB = await req('POST', '/api/cases', { case_number: `FB-${tag}`, title: 'Finance B' }, auth(lawB.token));
  const caseIdA = caseA.body?.id;
  const caseIdB = caseB.body?.id;

  const clientA = await setupActiveClient(lawA.token, caseIdA, '09130001111', `a.${tag}`);

  const putFee = await req('PUT', `/api/cases/${caseIdA}/finance`, { agreedFee: 100000000 }, auth(lawA.token));
  assert('1 lawyer owner can create finance', putFee.status === 200 && putFee.body?.agreedFee === 100000000);

  const putFee2 = await req('PUT', `/api/cases/${caseIdA}/finance`, { agreedFee: 120000000 }, auth(lawA.token));
  assert('2 lawyer owner can update agreed fee', putFee2.status === 200 && putFee2.body?.agreedFee === 120000000);

  const pay1 = await req('POST', `/api/cases/${caseIdA}/payments`, {
    amount: 70000000,
    paymentDate: '2026-09-28',
    description: 'پرداخت اول'
  }, auth(lawA.token));
  assert('3 lawyer owner can record payment', pay1.status === 201 && pay1.body?.status === 'recorded');
  const paymentId = pay1.body?.id;
  assert('3b created_by from auth', pay1.body?.createdByUserId === lawA.userId);

  const cancel = await req('POST', `/api/cases/${caseIdA}/payments/${paymentId}/cancel`, {}, auth(lawA.token));
  assert('4 lawyer owner can cancel payment', cancel.status === 200 && cancel.body?.status === 'cancelled');

  const pay2 = await req('POST', `/api/cases/${caseIdA}/payments`, {
    amount: 50000000,
    paymentDate: '2026-09-27',
    description: 'دوم'
  }, auth(lawA.token));
  assert('4b second payment for list', pay2.status === 201);

  const listPay = await req('GET', `/api/cases/${caseIdA}/payments`, null, auth(lawA.token));
  assert('5 lawyer owner can list payments', listPay.status === 200 && listPay.body?.length >= 2);

  const summary = await req('GET', `/api/cases/${caseIdA}/finance`, null, auth(lawA.token));
  assert('6 lawyer owner can read finance summary', summary.status === 200 && summary.body?.totalPaid === 50000000);
  assert('18 cancelled excluded from total_paid', summary.body?.totalPaid === 50000000 && summary.body?.remaining === 70000000);
  assert('19 remaining calculation', summary.body?.remaining === 70000000 && summary.body?.overpaid === false);

  assert('7 unrelated lawyer denied', (await req('GET', `/api/cases/${caseIdA}/finance`, null, auth(lawB.token))).status === 404);

  const portalFin = await req('GET', `/api/portal/cases/${caseIdA}/finance`, null, auth(clientA.token));
  assert('8 client active can read finance', portalFin.status === 200 && portalFin.body?.agreedFee === 120000000);

  const portalPays = await req('GET', `/api/portal/cases/${caseIdA}/payments`, null, auth(clientA.token));
  assert('9 client can read payments', portalPays.status === 200 && portalPays.body?.length === 1);
  assert('9b portal only recorded', portalPays.body?.every((p) => p.status === 'recorded'));

  const pendingCase = await req('POST', '/api/cases', { case_number: `FP-${tag}`, title: 'P' }, auth(lawB.token));
  const pendingClient = await req('POST', '/api/clients', {
    name: 'P', phone: '09130002222', case_id: pendingCase.body.id
  }, auth(lawB.token));
  const pendingUser = await createClientUser(`p.${tag}`, '09130002222');
  await db('clients').where({ id: pendingClient.body.id }).update({ user_id: pendingUser.userId });
  await req('POST', `/api/cases/${pendingCase.body.id}/client-access/invite`, { clientId: pendingClient.body.id }, auth(lawB.token));
  assert('10 pending client cannot read finance', (await req('GET', `/api/portal/cases/${pendingCase.body.id}/finance`, null, auth(pendingUser.token))).status === 404);

  const clientB = await setupActiveClient(lawB.token, caseIdB, '09130003333', `b.${tag}`);
  const accB = await db('case_client_access').where({ case_id: caseIdB, client_id: clientB.clientId }).first();
  await req('DELETE', `/api/cases/${caseIdB}/client-access/${accB.id}`, null, auth(lawB.token));
  assert('11 revoked client cannot read finance', (await req('GET', `/api/portal/cases/${caseIdB}/finance`, null, auth(clientB.token))).status === 404);

  assert('12 unrelated client cannot read finance', (await req('GET', `/api/portal/cases/${caseIdA}/finance`, null, auth(clientB.token))).status === 404);

  assert('13 client cannot create payment', (await req('POST', `/api/cases/${caseIdA}/payments`, {
    amount: 1, paymentDate: '2026-09-28'
  }, auth(clientA.token))).status === 403);

  assert('14 client cannot update agreed fee', (await req('PUT', `/api/cases/${caseIdA}/finance`, { agreedFee: 1 }, auth(clientA.token))).status === 403);

  assert('15 client cannot cancel payment', (await req('POST', `/api/cases/${caseIdA}/payments/${pay2.body.id}/cancel`, {}, auth(clientA.token))).status === 403);

  const spoof = await req('POST', `/api/cases/${caseIdA}/payments`, {
    amount: 1000,
    paymentDate: '2026-09-28',
    created_by_user_id: clientA.userId,
    createdByUserId: clientA.userId
  }, auth(lawA.token));
  assert('16 created_by cannot be spoofed', spoof.status === 201 && spoof.body?.createdByUserId === lawA.userId);

  assert('17 wrong caseId IDOR', (await req('GET', `/api/portal/cases/${caseIdB}/finance`, null, auth(clientA.token))).status === 404);

  await req('PUT', `/api/cases/${caseIdB}/finance`, { agreedFee: 100000000 }, auth(lawB.token));
  await req('POST', `/api/cases/${caseIdB}/payments`, { amount: 120000000, paymentDate: '2026-09-28' }, auth(lawB.token));
  const over = await req('GET', `/api/cases/${caseIdB}/finance`, null, auth(lawB.token));
  assert('20 overpaid calculation', over.body?.overpaid === true && over.body?.remaining === -20000000);

  assert('21 negative fee rejected', (await req('PUT', `/api/cases/${caseIdA}/finance`, { agreedFee: -1 }, auth(lawA.token))).status === 400);
  assert('22 zero payment rejected', (await req('POST', `/api/cases/${caseIdA}/payments`, {
    amount: 0, paymentDate: '2026-09-28'
  }, auth(lawA.token))).status === 400);

  assert('23 invalid payment date', (await req('POST', `/api/cases/${caseIdA}/payments`, {
    amount: 100, paymentDate: 'bad'
  }, auth(lawA.token))).status === 400);

  const dupCancel = await req('POST', `/api/cases/${caseIdA}/payments/${paymentId}/cancel`, {}, auth(lawA.token));
  assert('23b duplicate cancel rejected', dupCancel.status === 400);

  const feeNotifRow = await db('notifications')
    .where({ user_id: clientA.userId, type: 'fee_updated', case_id: caseIdA })
    .first();
  const lawFeeNotif = await countNotifs(lawA.userId, 'fee_updated', caseIdA);
  assert('24 notification recipient isolation (client gets fee)', !!feeNotifRow);
  assert('25 actor excluded from notification', lawFeeNotif === 0);

  const payN = await req('POST', `/api/cases/${caseIdA}/payments`, {
    amount: 1000000, paymentDate: '2026-09-26', description: 'notify'
  }, auth(lawA.token));
  const clientPayNotif = await db('notifications')
    .where({ user_id: clientA.userId, type: 'payment_recorded', entity_id: payN.body?.id })
    .first();
  assert('24b payment_recorded to client', !!clientPayNotif);

  const pendingBefore = await countNotifs(pendingUser.userId, 'payment_recorded', pendingCase.body.id);
  await req('POST', `/api/cases/${pendingCase.body.id}/payments`, {
    amount: 5000, paymentDate: '2026-09-28'
  }, auth(lawB.token));
  const pendingAfter = await countNotifs(pendingUser.userId, 'payment_recorded', pendingCase.body.id);
  assert('26 no notification to pending client', pendingBefore === pendingAfter);

  const revokedBefore = await countNotifs(clientB.userId, 'fee_updated', caseIdB);
  await req('PUT', `/api/cases/${caseIdB}/finance`, { agreedFee: 999 }, auth(lawB.token));
  const revokedAfter = await countNotifs(clientB.userId, 'fee_updated', caseIdB);
  assert('26b no notification to revoked client', revokedBefore === revokedAfter);

  server.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    failed.forEach((f) => console.error('  FAIL:', f.name, f.detail));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  if (server) server.close();
  process.exit(1);
});
