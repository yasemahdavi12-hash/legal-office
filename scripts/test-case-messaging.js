/**
 * Secure case messaging — authorization, validation, read/unread, IDOR, rate limit, UI safety.
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
          resolve({ status: res.statusCode, body: json, headers: res.headers, raw });
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
  const email = `law.msg.${tag}@test.local`;
  const password = 'LawyerPass99!';
  const reg = await req('POST', '/api/register', {
    name: 'وکیل ' + tag,
    email,
    password,
    role: 'lawyer'
  });
  return { token: reg.body.accessToken || reg.body.token, userId: reg.body.user?.id };
}

async function createClientUser(tag, phone) {
  const email = `client.msg.${tag}@test.local`;
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

async function main() {
  await db.migrate.latest();
  const hasTable = await db.schema.hasTable('case_messages');
  assert('migration case_messages table exists', hasTable);

  server = createApp().listen(0);
  PORT = server.address().port;
  console.log(`\nCase messaging tests → :${PORT}\n`);

  const tag = `${Date.now()}.${crypto.randomBytes(2).toString('hex')}`;
  const lawA = await registerLawyer(`a.${tag}`);
  const lawB = await registerLawyer(`b.${tag}`);

  const caseA = await req('POST', '/api/cases', { case_number: `MA-${tag}`, title: 'A' }, auth(lawA.token));
  const caseB = await req('POST', '/api/cases', { case_number: `MB-${tag}`, title: 'B' }, auth(lawB.token));
  const caseIdA = caseA.body?.id;
  const caseIdB = caseB.body?.id;

  const clientRec = await req('POST', '/api/clients', {
    name: 'موکل',
    phone: '09123334455',
    case_id: caseIdA
  }, auth(lawA.token));
  const clientId = clientRec.body?.id;
  const clientUser = await createClientUser(`a.${tag}`, '09123334455');
  await db('clients').where({ id: clientId }).update({ user_id: clientUser.userId });

  const inv = await req('POST', `/api/cases/${caseIdA}/client-access/invite`, { clientId }, auth(lawA.token));
  await req('POST', `/api/portal/client-access/${inv.body.id}/accept`, {}, auth(clientUser.token));

  assert('1 lawyer authorization — send', (await req('POST', `/api/cases/${caseIdA}/messages`, { body: 'law' }, auth(lawA.token))).status === 201);
  assert('2 client active access — send', (await req('POST', `/api/portal/cases/${caseIdA}/messages`, { body: 'cli' }, auth(clientUser.token))).status === 201);

  const clientBRec = await req('POST', '/api/clients', { name: 'B', phone: '09124445566', case_id: caseIdB }, auth(lawB.token));
  const clientIdB = clientBRec.body?.id;
  const userB = await createClientUser(`b.${tag}`, '09124445566');
  await db('clients').where({ id: clientIdB }).update({ user_id: userB.userId });
  const invB = await req('POST', `/api/cases/${caseIdB}/client-access/invite`, { clientId: clientIdB }, auth(lawB.token));

  assert('3 pending access blocked', (await req('POST', `/api/portal/cases/${caseIdB}/messages`, { body: 'pending' }, auth(userB.token))).status === 404);
  assert('3b pending cannot list', (await req('GET', `/api/portal/cases/${caseIdB}/messages`, null, auth(userB.token))).status === 404);

  await req('POST', `/api/portal/client-access/${invB.body.id}/accept`, {}, auth(userB.token));
  const revokeB = await req('DELETE', `/api/cases/${caseIdB}/client-access/${invB.body.id}`, null, auth(lawB.token));
  assert('4 revoked access setup', revokeB.status === 200 && revokeB.body?.status === 'revoked');
  assert('4 revoked access blocked post', (await req('POST', `/api/portal/cases/${caseIdB}/messages`, { body: 'rev' }, auth(userB.token))).status === 404);
  assert('4b revoked cannot list messages', (await req('GET', `/api/portal/cases/${caseIdB}/messages`, null, auth(userB.token))).status === 404);

  assert('5 cross-case IDOR read', (await req('GET', `/api/cases/${caseIdB}/messages`, null, auth(lawA.token))).status === 404);
  assert('5b cross-case IDOR post', (await req('POST', `/api/cases/${caseIdB}/messages`, { body: 'x' }, auth(lawA.token))).status === 404);

  assert('6 cross-lawyer IDOR', (await req('GET', `/api/cases/${caseIdA}/messages`, null, auth(lawB.token))).status === 404);

  assert('7 cross-client IDOR read', (await req('GET', `/api/portal/cases/${caseIdB}/messages`, null, auth(clientUser.token))).status === 404);
  assert('7b cross-client IDOR post', (await req('POST', `/api/portal/cases/${caseIdB}/messages`, { body: 'x' }, auth(clientUser.token))).status === 404);

  const spoofUser = await req('POST', `/api/cases/${caseIdA}/messages`, {
    body: 'spoof user',
    sender_user_id: lawB.userId
  }, auth(lawA.token));
  assert('8 forged sender_user_id ignored', spoofUser.status === 201 && spoofUser.body?.senderUserId === lawA.userId,
    `got ${spoofUser.body?.senderUserId}`);

  const spoofClient = await req('POST', `/api/portal/cases/${caseIdA}/messages`, {
    body: 'spoof client',
    sender_client_id: clientIdB
  }, auth(clientUser.token));
  assert('9 forged sender_client_id ignored', spoofClient.status === 201 && spoofClient.body?.senderClientId === clientId,
    `got ${spoofClient.body?.senderClientId}`);

  assert('10 forged clientId in body ignored (portal)', spoofClient.body?.senderClientId === clientId);

  assert('11 unauthenticated rejected', (await req('GET', `/api/cases/${caseIdA}/messages`)).status === 401);

  assert('12 empty body rejected', (await req('POST', `/api/cases/${caseIdA}/messages`, { body: '' }, auth(lawA.token))).status === 400);
  assert('13 whitespace-only rejected', (await req('POST', `/api/cases/${caseIdA}/messages`, { body: '   \n\t' }, auth(lawA.token))).status === 400);

  const longBody = 'x'.repeat(5001);
  assert('14 body > 5000 rejected', (await req('POST', `/api/cases/${caseIdA}/messages`, { body: longBody }, auth(lawA.token))).status === 400);

  const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const portalSrc = fs.readFileSync(path.join(__dirname, '..', 'client-portal.html'), 'utf8');
  assert('15 XSS-safe index message body uses textContent',
    /function renderCaseMessages[\s\S]*bodyEl\.textContent/.test(indexSrc)
      && !/function renderCaseMessages[\s\S]*innerHTML[\s\S]*m\.body/.test(indexSrc));
  assert('15b XSS-safe portal message body uses textContent',
    /function renderPortalCaseMessages[\s\S]*bodyEl\.textContent/.test(portalSrc));

  let rateLimited = false;
  for (let i = 0; i < 45; i++) {
    const r = await req('POST', `/api/cases/${caseIdA}/messages`, { body: `rate ${i}` }, auth(lawA.token));
    if (r.status === 429) { rateLimited = true; break; }
  }
  assert('16 message POST rate limit', rateLimited);

  await db('case_messages').where({ case_id: caseIdA }).update({ read_at: null });

  const unreadLaw = await req('GET', `/api/cases/${caseIdA}/messages/unread-count`, null, auth(lawA.token));
  const clientOnlyUnread = unreadLaw.body?.unreadCount;
  assert('19 unread count for lawyer', unreadLaw.status === 200 && clientOnlyUnread >= 1, `count ${clientOnlyUnread}`);

  const unreadAfterOwn = await req('GET', `/api/cases/${caseIdA}/messages/unread-count`, null, auth(lawA.token));
  await req('POST', `/api/cases/${caseIdA}/messages`, { body: 'own msg unread test' }, auth(lawA.token));
  const unreadStill = await req('GET', `/api/cases/${caseIdA}/messages/unread-count`, null, auth(lawA.token));
  assert('20 own messages excluded from unread count',
    unreadStill.body?.unreadCount === unreadAfterOwn.body?.unreadCount,
    `${unreadAfterOwn.body?.unreadCount} vs ${unreadStill.body?.unreadCount}`);

  const markLaw = await req('POST', `/api/cases/${caseIdA}/messages/mark-read`, {}, auth(lawA.token));
  assert('18 mark-as-read lawyer authorized', markLaw.status === 200 && markLaw.body?.ok === true);
  const unreadZeroLaw = await req('GET', `/api/cases/${caseIdA}/messages/unread-count`, null, auth(lawA.token));
  assert('17 read_at set after mark-read (lawyer)', unreadZeroLaw.body?.unreadCount === 0, `count ${unreadZeroLaw.body?.unreadCount}`);

  const markIdor = await req('POST', `/api/cases/${caseIdB}/messages/mark-read`, {}, auth(lawA.token));
  assert('18b mark-as-read IDOR blocked', markIdor.status === 404, `status ${markIdor.status}`);

  await req('POST', `/api/cases/${caseIdA}/messages`, { body: 'for client read' }, auth(lawA.token));
  const unreadPortal = await req('GET', `/api/portal/cases/${caseIdA}/messages/unread-count`, null, auth(clientUser.token));
  assert('19b client unread count', unreadPortal.status === 200 && unreadPortal.body?.unreadCount >= 1);

  const markPortal = await req('POST', `/api/portal/cases/${caseIdA}/messages/mark-read`, {}, auth(clientUser.token));
  assert('18c mark-as-read client authorized', markPortal.status === 200);
  const unreadPortalZero = await req('GET', `/api/portal/cases/${caseIdA}/messages/unread-count`, null, auth(clientUser.token));
  assert('17b read_at client mark-read', unreadPortalZero.body?.unreadCount === 0);

  await req('POST', `/api/cases/${caseIdB}/messages`, { body: 'isolated B' }, auth(lawB.token));
  const listA = await req('GET', `/api/cases/${caseIdA}/messages`, null, auth(lawA.token));
  const listB = await req('GET', `/api/cases/${caseIdB}/messages`, null, auth(lawB.token));
  const bodiesA = (listA.body || []).map((m) => m.body);
  const bodiesB = (listB.body || []).map((m) => m.body);
  assert('21 message isolation by case', !bodiesA.includes('isolated B') && bodiesB.some((b) => b === 'isolated B'));

  for (let i = 0; i < 5; i++) {
    await req('POST', `/api/cases/${caseIdA}/messages`, { body: `pag ${i}` }, auth(lawA.token));
  }
  const page = await req('GET', `/api/cases/${caseIdA}/messages?limit=3`, null, auth(lawA.token));
  assert('22 pagination limit', page.status === 200 && page.body?.length === 3, `len ${page.body?.length}`);
  const ordered = page.body?.every((m, i, arr) => !i || new Date(arr[i - 1].createdAt) <= new Date(m.createdAt));
  assert('22b ascending order', ordered);

  const listLaw = await req('GET', `/api/cases/${caseIdA}/messages`, null, auth(lawA.token));
  assert('lawyer lists messages', listLaw.status === 200 && listLaw.body?.length >= 2);

  assert('lawyer cannot use portal message API', (await req('POST', `/api/portal/cases/${caseIdA}/messages`, { body: 'x' }, auth(lawA.token))).status === 403);
  const clientLawApi = await req('POST', `/api/cases/${caseIdA}/messages`, { body: 'x' }, auth(clientUser.token));
  assert('client cannot use lawyer message API', clientLawApi.status === 404 || clientLawApi.status === 403);

  try {
    await db('case_messages').whereIn('case_id', [caseIdA, caseIdB]).del();
    await db('case_client_access').whereIn('case_id', [caseIdA, caseIdB]).del();
    await db('clients').whereIn('id', [clientId, clientIdB]).del();
    await db('cases').whereIn('id', [caseIdA, caseIdB]).del();
    await db('users').whereIn('id', [lawA.userId, lawB.userId, clientUser.userId, userB.userId]).del();
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
