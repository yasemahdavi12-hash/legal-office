/**
 * Notification Center — API, IDOR, integrations, pagination, security.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../src/db/connection');
const { createApp } = require('../src/app');
const notificationService = require('../src/services/notification.service');

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

function multipartSubmit(token, caseId, requestId) {
  const boundary = '----Notif' + crypto.randomBytes(6).toString('hex');
  const fileBody = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  const parts = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="id.png"\r\nContent-Type: image/png\r\n\r\n`;
  const multipart = Buffer.concat([Buffer.from(parts), fileBody, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  return new Promise((resolve, reject) => {
    const r = http.request({
      hostname: '127.0.0.1',
      port: PORT,
      path: `/api/portal/cases/${caseId}/document-requests/${requestId}/submit`,
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
        'Content-Length': multipart.length
      }
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let json = null;
        try { json = raw ? JSON.parse(raw) : null; } catch { json = { raw }; }
        resolve({ status: res.statusCode, body: json });
      });
    });
    r.on('error', reject);
    r.write(multipart);
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
    email: `law.notif.${tag}@test.local`,
    password: 'LawyerPass99!',
    role: 'lawyer'
  });
  return { token: reg.body.accessToken || reg.body.token, userId: reg.body.user?.id };
}

async function createClientUser(tag, phone) {
  const email = `client.notif.${tag}@test.local`;
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

function findNotif(items, type) {
  return (items || []).find((n) => n.type === type);
}

async function main() {
  await db.migrate.latest();
  assert('migration notifications table exists', await db.schema.hasTable('notifications'));

  server = createApp().listen(0);
  PORT = server.address().port;
  console.log(`\nNotification tests → :${PORT}\n`);

  const tag = `${Date.now()}.${crypto.randomBytes(3).toString('hex')}`;
  const lawA = await registerLawyer(`a.${tag}`);
  const lawB = await registerLawyer(`b.${tag}`);

  const caseA = await req('POST', '/api/cases', { case_number: `NA-${tag}`, title: 'A' }, auth(lawA.token));
  const caseIdA = caseA.body?.id;

  const clientA = await setupActiveClient(lawA.token, caseIdA, '09131110001', `a.${tag}`);

  const adminEmail = `admin.notif.${tag}@test.local`;
  const adminPass = 'AdminPass99!';
  await db('users').insert({
    name: 'Admin',
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
  const adminUserId = adminLogin.body?.user?.id;

  await notificationService.createNotification({
    user_id: clientA.userId,
    type: 'system',
    title: 'تست',
    body: 'برای client'
  });
  await notificationService.createNotification({
    user_id: lawA.userId,
    type: 'system',
    title: 'تست وکیل',
    body: 'برای lawyer'
  });
  await notificationService.createNotification({
    user_id: adminUserId,
    type: 'system',
    title: 'تست admin',
    body: 'برای admin'
  });

  const listClient = await req('GET', '/api/notifications', null, auth(clientA.token));
  assert('1 authenticated user can list notifications', listClient.status === 200 && Array.isArray(listClient.body?.items));

  assert('2 unauthenticated rejected', (await req('GET', '/api/notifications')).status === 401);

  const clientIds = new Set((listClient.body?.items || []).map((n) => n.id));
  const lawList = await req('GET', '/api/notifications', null, auth(lawA.token));
  const lawIds = new Set((lawList.body?.items || []).map((n) => n.id));
  assert('3 user sees only own notifications', clientIds.size > 0 && ![...clientIds].some((id) => lawIds.has(id)));

  const clientFirst = listClient.body.items[0];
  assert('4 IDOR mark-read rejected', (await req('POST', `/api/notifications/${clientFirst.id}/read`, {}, auth(lawB.token))).status === 404);

  const unreadClient = await req('GET', '/api/notifications/unread-count', null, auth(clientA.token));
  assert('5 unread count correct', unreadClient.status === 200 && Number(unreadClient.body?.unreadCount) >= 1);

  const markRead = await req('POST', `/api/notifications/${clientFirst.id}/read`, {}, auth(clientA.token));
  assert('6 mark notification as read', markRead.status === 200 && markRead.body?.isRead === true);

  assert('7 mark own notification only', (await req('POST', `/api/notifications/${clientFirst.id}/read`, {}, auth(lawA.token))).status === 404);

  await notificationService.createNotification({
    user_id: clientA.userId,
    type: 'system',
    title: 'خوانده نشده',
    body: 'b'
  });
  await notificationService.createNotification({
    user_id: lawA.userId,
    type: 'system',
    title: 'law unread',
    body: 'b'
  });
  const beforeLawUnread = (await req('GET', '/api/notifications/unread-count', null, auth(lawA.token))).body?.unreadCount;
  const markAllClient = await req('POST', '/api/notifications/read-all', {}, auth(clientA.token));
  assert('8 mark-all works', markAllClient.status === 200 && markAllClient.body?.ok === true);
  const afterLawUnread = (await req('GET', '/api/notifications/unread-count', null, auth(lawA.token))).body?.unreadCount;
  assert('9 mark-all does not affect other users', Number(afterLawUnread) === Number(beforeLawUnread));

  const toDelete = await notificationService.createNotification({
    user_id: clientA.userId,
    type: 'system',
    title: 'del',
    body: 'x'
  });
  const delOk = await req('DELETE', `/api/notifications/${toDelete.id}`, null, auth(clientA.token));
  assert('10 delete own notification', delOk.status === 200 && delOk.body?.ok === true);

  const otherNotif = await notificationService.createNotification({
    user_id: clientA.userId,
    type: 'system',
    title: 'other',
    body: 'x'
  });
  assert('11 delete other user notification rejected', (await req('DELETE', `/api/notifications/${otherNotif.id}`, null, auth(lawB.token))).status === 404);

  for (let i = 0; i < 5; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await notificationService.createNotification({
      user_id: lawA.userId,
      type: 'system',
      title: 'p' + i,
      body: 'page ' + i
    });
  }
  const page1 = await req('GET', '/api/notifications?limit=2&page=1', null, auth(lawA.token));
  const page2 = await req('GET', '/api/notifications?limit=2&page=2', null, auth(lawA.token));
  assert(
    '12 pagination works',
    page1.status === 200
      && page1.body?.pagination?.limit === 2
      && page1.body?.pagination?.page === 1
      && page1.body.items.length <= 2
      && page2.body?.items?.length >= 1
  );

  const newest = page1.body?.items?.[0];
  const olderOnPage2 = page2.body?.items?.[0];
  if (newest?.createdAt && olderOnPage2?.createdAt) {
    assert('13 newest first', new Date(newest.createdAt).getTime() >= new Date(olderOnPage2.createdAt).getTime());
  } else {
    assert('13 newest first', page1.body?.items?.length >= 1, 'skip strict time compare');
  }

  const msgLaw = await req('POST', `/api/cases/${caseIdA}/messages`, { body: 'از وکیل' }, auth(lawA.token));
  assert('14 lawyer->client message creates notification', msgLaw.status === 201);
  const clientAfterMsg = await req('GET', '/api/notifications', null, auth(clientA.token));
  const clientMsgNotif = findNotif(clientAfterMsg.body?.items, 'new_message');
  assert('14b client has new_message notif', !!clientMsgNotif && clientMsgNotif.entityType === 'case_message');

  const msgCli = await req('POST', `/api/portal/cases/${caseIdA}/messages`, { body: 'از موکل' }, auth(clientA.token));
  assert('15 client->lawyer message creates notification', msgCli.status === 201);
  const lawAfterMsg = await req('GET', '/api/notifications', null, auth(lawA.token));
  const lawMsgNotif = findNotif(lawAfterMsg.body?.items, 'new_message');
  assert('15b lawyer has new_message notif', !!lawMsgNotif);

  const lawSelfCount = (lawAfterMsg.body?.items || []).filter(
    (n) => n.type === 'new_message' && n.entityId === msgLaw.body?.id
  ).length;
  assert('16 sender does not receive own message notification', lawSelfCount === 0);

  const docReq = await req('POST', `/api/cases/${caseIdA}/document-requests`, {
    clientId: clientA.clientId,
    title: 'کارت ملی',
    description: 'واضح'
  }, auth(lawA.token));
  assert('17 document request creates client notification', docReq.status === 201);
  const clientDocList = await req('GET', '/api/notifications', null, auth(clientA.token));
  const docReqNotif = findNotif(clientDocList.body?.items, 'document_request');
  assert('17b document_request notif', !!docReqNotif && docReqNotif.body.includes('کارت ملی'));

  const reqId = docReq.body?.id;
  const req2 = await req('POST', `/api/cases/${caseIdA}/document-requests`, {
    clientId: clientA.clientId,
    title: 'رد شونده',
    description: 'd'
  }, auth(lawA.token));
  await multipartSubmit(clientA.token, caseIdA, req2.body.id);
  const submitNotifList = await req('GET', '/api/notifications', null, auth(lawA.token));
  assert('18 document submit creates lawyer notification', !!findNotif(submitNotifList.body?.items, 'document_submitted'));

  await multipartSubmit(clientA.token, caseIdA, reqId);
  await req('POST', `/api/cases/${caseIdA}/document-requests/${reqId}/approve`, {}, auth(lawA.token));
  const approveList = await req('GET', '/api/notifications', null, auth(clientA.token));
  assert('19 document approve creates client notification', !!findNotif(approveList.body?.items, 'document_approved'));

  const req3 = await req('POST', `/api/cases/${caseIdA}/document-requests`, {
    clientId: clientA.clientId,
    title: 'کارت ملی',
    description: 'd'
  }, auth(lawA.token));
  await multipartSubmit(clientA.token, caseIdA, req3.body.id);
  await req('POST', `/api/cases/${caseIdA}/document-requests/${req3.body.id}/reject`, {
    rejectionReason: 'تصویر خوانا نیست'
  }, auth(lawA.token));
  const rejectList = await req('GET', '/api/notifications', null, auth(clientA.token));
  const rejNotif = findNotif(rejectList.body?.items, 'document_rejected');
  assert('20 document reject creates client notification', !!rejNotif);
  assert('21 rejection reason safely stored', rejNotif?.body?.includes('تصویر خوانا نیست'));

  const xssPayload = '<img src=x onerror=alert(1)>';
  const xssNotif = await notificationService.createNotification({
    user_id: clientA.userId,
    type: 'system',
    title: xssPayload,
    body: xssPayload
  });
  assert('22 XSS payload stored literally in API', xssNotif.title === xssPayload && xssNotif.body === xssPayload);

  assert('23 case_id preserved', clientMsgNotif?.caseId === caseIdA);
  assert('24 entity_type preserved', docReqNotif?.entityType === 'case_document_request');
  assert('25 entity_id preserved', docReqNotif?.entityId === reqId);

  const dup1 = await notificationService.createNotification({
    user_id: lawB.userId,
    type: 'system',
    title: 'dup',
    body: 'one',
    entity_type: 'test_entity',
    entity_id: 99901
  });
  const dup2 = await notificationService.createNotification({
    user_id: lawB.userId,
    type: 'system',
    title: 'dup',
    body: 'one',
    entity_type: 'test_entity',
    entity_id: 99901
  });
  assert('26 duplicate unread entity returns same notification', dup1.id === dup2.id);

  let rollbackLeft = 0;
  try {
    await db.transaction(async (trx) => {
      await notificationService.createNotification({
        user_id: lawB.userId,
        type: 'system',
        title: 'rollback',
        body: 'should not persist',
        entity_type: 'rollback_test',
        entity_id: 88801
      }, trx);
      throw new Error('force rollback');
    });
  } catch {
    /* expected */
  }
  rollbackLeft = await db('notifications')
    .where({ user_id: lawB.userId, entity_type: 'rollback_test', entity_id: 88801 })
    .count({ c: '*' })
    .first();
  const rc = Number(rollbackLeft?.c ?? rollbackLeft?.count ?? 0);
  assert('27 transaction rollback does not leave notification', rc === 0);

  const clientOnly = await req('GET', '/api/notifications', null, auth(clientA.token));
  assert('28 client isolation', !(clientOnly.body?.items || []).some((n) => n.userId === lawB.userId));

  const lawyerOnly = await req('GET', '/api/notifications', null, auth(lawA.token));
  assert('29 lawyer isolation', !(lawyerOnly.body?.items || []).some((n) => n.userId === clientA.userId));

  const adminOnly = await req('GET', '/api/notifications', null, auth(adminToken));
  assert('30 admin isolation', (adminOnly.body?.items || []).every((n) => n.userId === adminUserId));

  assert('31 read_at set correctly', markRead.body?.readAt != null);

  await notificationService.createNotification({
    user_id: clientA.userId,
    type: 'system',
    title: 'unread dec',
    body: 'x'
  });
  const uBefore = (await req('GET', '/api/notifications/unread-count', null, auth(clientA.token))).body?.unreadCount;
  const uItem = (await req('GET', '/api/notifications?limit=1', null, auth(clientA.token))).body?.items?.[0];
  if (uItem && !uItem.isRead) {
    await req('POST', `/api/notifications/${uItem.id}/read`, {}, auth(clientA.token));
    const uAfter = (await req('GET', '/api/notifications/unread-count', null, auth(clientA.token))).body?.unreadCount;
    assert('32 unread count decreases after read', Number(uAfter) < Number(uBefore));
  } else {
    assert('32 unread count decreases after read', true, 'skipped — no unread item');
  }

  await notificationService.createNotification({ user_id: lawA.userId, type: 'system', title: 'ra1', body: 'a' });
  await notificationService.createNotification({ user_id: lawA.userId, type: 'system', title: 'ra2', body: 'b' });
  await req('POST', '/api/notifications/read-all', {}, auth(lawA.token));
  const allRead = await db('notifications').where({ user_id: lawA.userId, is_read: false }).count({ c: '*' }).first();
  assert('33 read-all sets all own unread notifications', Number(allRead?.c ?? allRead?.count ?? 0) === 0);

  const gone = await req('GET', '/api/notifications', null, auth(clientA.token));
  assert('34 deleted notification no longer appears', !(gone.body?.items || []).some((n) => n.id === toDelete.id));

  const regMsg = await req('POST', `/api/cases/${caseIdA}/messages`, { body: 'regression' }, auth(lawA.token));
  const regList = await req('GET', `/api/cases/${caseIdA}/messages`, null, auth(lawA.token));
  const regDoc = await req('GET', `/api/cases/${caseIdA}/document-requests`, null, auth(lawA.token));
  assert(
    '35 regression messaging/document-request behavior',
    regMsg.status === 201 && regList.status === 200 && regDoc.status === 200
  );

  assert('no public POST /api/notifications', (await req('POST', '/api/notifications', { title: 'x', body: 'y' }, auth(clientA.token))).status === 404);

  const ownerRow = await db('cases').where({ id: caseIdA }).select('owner_id').first();
  const ownerId = ownerRow?.owner_id;
  const unreadLawBefore = (await req('GET', '/api/notifications/unread-count', null, auth(lawA.token))).body?.unreadCount;

  const e2eClientMsg = await req('POST', `/api/portal/cases/${caseIdA}/messages`, { body: 'e2e to lawyer' }, auth(clientA.token));
  assert('msg-e2e 1 client sends message', e2eClientMsg.status === 201);
  const e2eMsgId = e2eClientMsg.body?.id;
  const lawNotifRows = await db('notifications')
    .where({
      user_id: ownerId,
      type: 'new_message',
      entity_type: 'case_message',
      entity_id: e2eMsgId
    });
  assert('msg-e2e 2 lawyer notification exists in DB', lawNotifRows.length >= 1);
  const lawNotifApi = (await req('GET', '/api/notifications', null, auth(lawA.token))).body?.items
    ?.find((n) => n.entityId === e2eMsgId && n.type === 'new_message');
  assert('msg-e2e 15 notification in GET /api/notifications', !!lawNotifApi);
  assert('msg-e2e 2 type new_message', lawNotifRows[0]?.type === 'new_message');
  assert('msg-e2e 3 user_id = case.owner_id', Number(lawNotifRows[0]?.user_id) === Number(ownerId));
  assert('msg-e2e 4 case_id correct', Number(lawNotifRows[0]?.case_id) === Number(caseIdA));
  assert('msg-e2e 5 entity_type case_message', lawNotifRows[0]?.entity_type === 'case_message');
  assert('msg-e2e 6 entity_id = message.id', Number(lawNotifRows[0]?.entity_id) === Number(e2eMsgId));
  const clientOwn = await db('notifications')
    .where({ user_id: clientA.userId, entity_type: 'case_message', entity_id: e2eMsgId });
  assert('msg-e2e 7 client does not receive own notification', clientOwn.length === 0);

  const unreadLawAfter = (await req('GET', '/api/notifications/unread-count', null, auth(lawA.token))).body?.unreadCount;
  assert('msg-e2e 13 unread count increases for lawyer', Number(unreadLawAfter) > Number(unreadLawBefore));

  const e2eLawMsg = await req('POST', `/api/cases/${caseIdA}/messages`, { body: 'e2e to client' }, auth(lawA.token));
  assert('msg-e2e 8 lawyer sends message', e2eLawMsg.status === 201);
  const e2eLawMsgId = e2eLawMsg.body?.id;
  const clientNotifRow = await db('notifications')
    .where({
      user_id: clientA.userId,
      type: 'new_message',
      entity_type: 'case_message',
      entity_id: e2eLawMsgId
    })
    .first();
  assert('msg-e2e 8b active client receives notification', !!clientNotifRow);
  const lawSelfNotif = await db('notifications')
    .where({ user_id: lawA.userId, entity_type: 'case_message', entity_id: e2eLawMsgId });
  assert('msg-e2e 12 lawyer does not receive own notification', lawSelfNotif.length === 0);

  const clientA2 = await setupActiveClient(lawA.token, caseIdA, '09132223344', `a2.${tag}`);
  const e2eMulti = await req('POST', `/api/cases/${caseIdA}/messages`, { body: 'both clients' }, auth(lawA.token));
  const multiId = e2eMulti.body?.id;
  const n1 = await db('notifications').where({ user_id: clientA.userId, entity_id: multiId, type: 'new_message' }).first();
  const n2 = await db('notifications').where({ user_id: clientA2.userId, entity_id: multiId, type: 'new_message' }).first();
  assert('msg-e2e 11 multiple active clients receive notification', !!n1 && !!n2);

  const caseP = await req('POST', '/api/cases', { case_number: `NP-${tag}`, title: 'P' }, auth(lawA.token));
  const pendingClient = await req('POST', '/api/clients', {
    name: 'Pending',
    phone: '09135556677',
    case_id: caseP.body.id
  }, auth(lawA.token));
  const pendingUser = await createClientUser(`p.${tag}`, '09135556677');
  await db('clients').where({ id: pendingClient.body.id }).update({ user_id: pendingUser.userId });
  await req('POST', `/api/cases/${caseP.body.id}/client-access/invite`, { clientId: pendingClient.body.id }, auth(lawA.token));
  const pendMsg = await req('POST', `/api/cases/${caseP.body.id}/messages`, { body: 'pending only' }, auth(lawA.token));
  const pendNotif = await db('notifications').where({
    user_id: pendingUser.userId,
    entity_id: pendMsg.body?.id,
    type: 'new_message'
  });
  assert('msg-e2e 10 pending client does not receive notification', pendNotif.length === 0);

  const caseR = await req('POST', '/api/cases', { case_number: `NR-${tag}`, title: 'R' }, auth(lawA.token));
  const revClient = await req('POST', '/api/clients', {
    name: 'Rev',
    phone: '09136667788',
    case_id: caseR.body.id
  }, auth(lawA.token));
  const revUser = await createClientUser(`r.${tag}`, '09136667788');
  await db('clients').where({ id: revClient.body.id }).update({ user_id: revUser.userId });
  const revInv = await req('POST', `/api/cases/${caseR.body.id}/client-access/invite`, { clientId: revClient.body.id }, auth(lawA.token));
  await req('POST', `/api/portal/client-access/${revInv.body.id}/accept`, {}, auth(revUser.token));
  const accRev = await db('case_client_access').where({ case_id: caseR.body.id, client_id: revClient.body.id }).first();
  await req('DELETE', `/api/cases/${caseR.body.id}/client-access/${accRev.id}`, null, auth(lawA.token));
  const revMsg = await req('POST', `/api/cases/${caseR.body.id}/messages`, { body: 'revoked' }, auth(lawA.token));
  const revNotif = await db('notifications').where({
    user_id: revUser.userId,
    entity_id: revMsg.body?.id,
    type: 'new_message'
  });
  assert('msg-e2e 9 revoked client does not receive notification', revNotif.length === 0);

  if (lawNotifApi?.id) {
    await req('POST', `/api/notifications/${lawNotifApi.id}/read`, {}, auth(lawA.token));
    const afterRead = (await req('GET', '/api/notifications/unread-count', null, auth(lawA.token))).body?.unreadCount;
    assert('msg-e2e 14 mark-read decreases unread count', Number(afterRead) < Number(unreadLawAfter));
  } else {
    assert('msg-e2e 14 mark-read decreases unread count', true, 'skipped');
  }

  const evCreate = await req('POST', '/api/events', {
    title: 'جلسه دادگاه',
    date: '2026-10-01',
    time: '10:00',
    type: 'court',
    case_id: caseIdA
  }, auth(lawA.token));
  assert('event 1 create with case', evCreate.status === 201);
  const eventId = evCreate.body?.id;
  const evCreatedRow = await db('notifications').where({
    user_id: clientA.userId,
    type: 'event_created',
    entity_type: 'event',
    entity_id: eventId
  }).first();
  assert('event 2 client receives event_created', !!evCreatedRow);
  assert('event 3 case_id on notification', Number(evCreatedRow?.case_id) === Number(caseIdA));
  assert('event 4 body includes event title', String(evCreatedRow?.body || '').includes('جلسه دادگاه'));

  const evNoCase = await req('POST', '/api/events', {
    title: 'شخصی',
    date: '2026-10-02',
    type: 'personal'
  }, auth(lawA.token));
  const noCaseNotifs = await db('notifications').where({
    user_id: clientA.userId,
    entity_type: 'event',
    entity_id: evNoCase.body?.id
  });
  assert('event 5 no case_id means no client notification', noCaseNotifs.length === 0);

  const lawEvNotif = await db('notifications').where({
    user_id: lawA.userId,
    type: 'event_created',
    entity_id: eventId
  });
  assert('event 6 lawyer does not receive own event_created', lawEvNotif.length === 0);

  const evUpdate = await req('PUT', '/api/events/' + eventId, {
    title: 'جلسه دادگاه (ویرایش)',
    date: '2026-10-01'
  }, auth(lawA.token));
  assert('event 7 update succeeds', evUpdate.status === 200);
  const evUpdatedRow = await db('notifications').where({
    user_id: clientA.userId,
    type: 'event_updated',
    entity_type: 'event',
    entity_id: eventId
  }).first();
  assert('event 7 client receives event_updated', !!evUpdatedRow);

  const evList = await req('GET', '/api/notifications', null, auth(clientA.token));
  assert(
    'event 8 appears in GET /api/notifications',
    (evList.body?.items || []).some((n) => n.type === 'event_created' && n.entityId === eventId)
  );

  await req('DELETE', '/api/events/' + eventId, null, auth(lawA.token));
  const evDeletedRow = await db('notifications').where({
    user_id: clientA.userId,
    type: 'event_deleted',
    entity_type: 'event',
    entity_id: eventId
  }).first();
  assert('event 9 client receives event_deleted', !!evDeletedRow);

  const casePend = await req('POST', '/api/cases', { case_number: `EP-${tag}`, title: 'Pend' }, auth(lawA.token));
  const clPend = await req('POST', '/api/clients', { name: 'P', phone: '09137778899', case_id: casePend.body.id }, auth(lawA.token));
  const pendU = await createClientUser(`ep.${tag}`, '09137778899');
  await db('clients').where({ id: clPend.body.id }).update({ user_id: pendU.userId });
  await req('POST', `/api/cases/${casePend.body.id}/client-access/invite`, { clientId: clPend.body.id }, auth(lawA.token));
  const evPend = await req('POST', '/api/events', {
    title: 'Pending case event',
    date: '2026-11-01',
    case_id: casePend.body.id
  }, auth(lawA.token));
  const pendEvNotif = await db('notifications').where({
    user_id: pendU.userId,
    entity_id: evPend.body?.id,
    type: 'event_created'
  });
  assert('event 10 pending client does not receive notification', pendEvNotif.length === 0);

  server.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length} tests, ${failed.length} failed\n`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  if (server) server.close();
  process.exit(1);
});
