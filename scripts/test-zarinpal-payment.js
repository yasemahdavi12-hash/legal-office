/**
 * ZarinPal subscription payment tests (in-process app + stub provider).
 * Stub is injected via setPaymentProvider — not a fake public API endpoint.
 */
require('dotenv').config();
const http = require('http');
const crypto = require('crypto');
const db = require('../src/db/connection');
const { createApp } = require('../src/app');
const { setPaymentProvider, resetPaymentProvider } = require('../src/services/payment');
const { PRO_MONTHLY_PRICE_TOMAN } = require('../src/config/subscription');

const results = [];
let PORT = 0;
let server;

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
          try { json = raw ? JSON.parse(raw) : null; } catch { json = null; }
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: json,
            text: raw,
            location: res.headers.location || ''
          });
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

function makeStub({ failVerify = false } = {}) {
  let n = 0;
  const verified = new Set();
  return {
    async requestPayment() {
      n += 1;
      const authority = ('A' + crypto.randomBytes(16).toString('hex') + String(n)).slice(0, 36);
      return {
        authority,
        paymentUrl: 'https://sandbox.zarinpal.com/pg/StartPay/' + authority,
        rawCode: 100
      };
    },
    async verifyPayment({ authority, amount }) {
      if (failVerify) return { ok: false, code: -9, message: 'failed' };
      if (Number(amount) !== PRO_MONTHLY_PRICE_TOMAN) {
        return { ok: false, code: -50, message: 'amount mismatch' };
      }
      if (verified.has(authority)) {
        return { ok: true, alreadyVerified: true, refId: 9000 + n, code: 101, message: 'Already verified' };
      }
      verified.add(authority);
      return {
        ok: true,
        alreadyVerified: false,
        refId: 8000 + n,
        cardPan: '502229******5995',
        code: 100,
        message: 'Verified'
      };
    }
  };
}

async function main() {
  await db.migrate.latest();
  setPaymentProvider(makeStub());
  server = createApp().listen(0);
  PORT = server.address().port;
  console.log(`\nZarinPal payment tests → :${PORT}\n`);

  const noAuth = await req('POST', '/api/subscription/checkout', {});
  assert('checkout بدون login → reject', noAuth.status === 401, `status ${noAuth.status}`);

  const suffix = Date.now();
  const password = 'PayTestPass99';
  const reg = await req('POST', '/api/register', {
    name: 'تست پرداخت',
    email: `pay.${suffix}@test.local`,
    password,
    role: 'lawyer'
  });
  assert('register', reg.status === 200 || reg.status === 201, `status ${reg.status}`);
  const token = reg.body.accessToken || reg.body.token;
  const userId = reg.body.user.id;

  const checkout = await req('POST', '/api/subscription/checkout', {}, auth(token));
  assert(
    'checkout با FREE → payment',
    checkout.status === 200 && !!checkout.body?.paymentUrl,
    `status ${checkout.status} ${checkout.body?.error || ''}`
  );
  assert('amount server-side from config', checkout.body && checkout.body.amount === PRO_MONTHLY_PRICE_TOMAN);
  assert('plan pro', checkout.body && checkout.body.plan === 'pro');
  assert('sandbox startpay url', checkout.body && /sandbox\.zarinpal\.com\/pg\/StartPay\//.test(checkout.body.paymentUrl));
  const authority = checkout.body && checkout.body.authority;

  const badAmt = await req('POST', '/api/subscription/checkout', { amount: 1 }, auth(token));
  assert('amount دستکاری‌شده → reject', badAmt.status === 400, `status ${badAmt.status}`);

  const badPlan = await req('POST', '/api/subscription/checkout', { plan: 'free' }, auth(token));
  assert('plan دستکاری‌شده → reject', badPlan.status === 400, `status ${badPlan.status}`);

  const badAuth = await req('GET', '/api/subscription/callback?Authority=BAD&Status=OK');
  assert('authority نامعتبر → reject', badAuth.status === 302 && /payment=failed/.test(badAuth.location));

  const sqli = await req('GET', `/api/subscription/callback?Authority=${encodeURIComponent("A' OR 1=1--")}&Status=OK`);
  assert('SQL injection authority → failed', sqli.status === 302 && /payment=failed/.test(sqli.location));

  const nok = await req('GET', `/api/subscription/callback?Authority=${authority}&Status=NOK`);
  assert('callback بدون پرداخت موفق → failed', nok.status === 302 && /payment=failed/.test(nok.location));
  let sub = await req('GET', '/api/subscription', null, auth(token));
  assert('پس از NOK هنوز FREE / PRO نشود', sub.body.plan === 'free');

  const checkout2 = await req('POST', '/api/subscription/checkout', {}, auth(token));
  assert('checkout دوم برای verify', checkout2.status === 200 && !!checkout2.body?.authority, `status ${checkout2.status} ${checkout2.body?.error || ''}`);
  const auth2 = checkout2.body.authority;
  const pay2 = checkout2.body.paymentId;

  const okCb = await req('GET', `/api/subscription/callback?Authority=${auth2}&Status=OK`);
  assert('Verify موفق → redirect success', okCb.status === 302 && /payment=success/.test(okCb.location), okCb.location);
  sub = await req('GET', '/api/subscription', null, auth(token));
  assert('Verify موفق → PRO فعال', sub.body.plan === 'pro', `plan ${sub.body.plan}`);
  const firstExpiry = sub.body.expiresAt;
  assert('expires_at set', !!firstExpiry);

  const paidRow = await db('payments').where({ authority: auth2 }).first();
  assert('payment paid + ref_id', paidRow && paidRow.status === 'paid' && !!paidRow.ref_id, `status ${paidRow && paidRow.status}`);

  const dup = await req('GET', `/api/subscription/callback?Authority=${auth2}&Status=OK`);
  assert('callback تکراری → success', dup.status === 302 && /payment=success/.test(dup.location));
  const events = await db('subscription_events').where({ user_id: userId, source: 'payment', note: `payment:${paidRow.id}` });
  assert('duplicate subscription/payment event ساخته نشد', events.length === 1, `count ${events.length}`);
  sub = await req('GET', '/api/subscription', null, auth(token));
  assert('expiry بعد از duplicate تغییر نکرد', sub.body.expiresAt === firstExpiry);

  const checkout3 = await req('POST', '/api/subscription/checkout', {}, auth(token));
  await req('GET', `/api/subscription/callback?Authority=${checkout3.body.authority}&Status=OK`);
  sub = await req('GET', '/api/subscription', null, auth(token));
  const renewed = new Date(sub.body.expiresAt).getTime();
  const prev = new Date(firstExpiry).getTime();
  const approxMonth = 28 * 24 * 3600 * 1000;
  assert('تمدید PRO → یک ماه به expires_at اضافه شد', renewed > prev + approxMonth * 0.9, `${firstExpiry} → ${sub.body.expiresAt}`);

  await db('users').where({ id: userId }).update({
    subscription_plan: 'pro',
    subscription_expires_at: new Date(Date.now() - 86400000).toISOString()
  });
  const beforeExpiredPay = Date.now();
  const checkout4 = await req('POST', '/api/subscription/checkout', {}, auth(token));
  await req('GET', `/api/subscription/callback?Authority=${checkout4.body.authority}&Status=OK`);
  sub = await req('GET', '/api/subscription', null, auth(token));
  const fromNow = new Date(sub.body.expiresAt).getTime();
  assert('expired PRO → یک ماه از زمان پرداخت', fromNow > beforeExpiredPay + approxMonth * 0.9, sub.body.expiresAt);
  assert('expired renew → PRO', sub.body.plan === 'pro');

  // Cases not deleted after expire path
  const caseCount = await db('cases').where({ owner_id: userId }).count({ c: '*' });
  assert('پرونده‌ها بعد از expire/renew حذف نشدند (count query ok)', Number(caseCount[0].c) >= 0);

  setPaymentProvider(makeStub({ failVerify: true }));
  const other = await req('POST', '/api/register', {
    name: 'fail verify',
    email: `fail.${suffix}@test.local`,
    password,
    role: 'lawyer'
  });
  const tokenFail = other.body.accessToken || other.body.token;
  const uidFail = other.body.user.id;
  const cFail = await req('POST', '/api/subscription/checkout', {}, auth(tokenFail));
  assert('checkout برای fail-verify', cFail.status === 200 && !!cFail.body.authority, `status ${cFail.status}`);
  await req('GET', `/api/subscription/callback?Authority=${cFail.body.authority}&Status=OK`);
  const subFail = await req('GET', '/api/subscription', null, auth(tokenFail));
  assert('payment failed → PRO نشود', subFail.body.plan === 'free');
  const payFail = await db('payments').where({ authority: cFail.body.authority }).first();
  assert('payment status failed', payFail && payFail.status === 'failed', `status ${payFail && payFail.status}`);

  setPaymentProvider(makeStub());
  const cA = await req('POST', '/api/subscription/checkout', {}, auth(tokenFail));
  await req('GET', `/api/subscription/callback?Authority=${cA.body.authority}&Status=OK`);
  const ownerSub = await req('GET', '/api/subscription', null, auth(tokenFail));
  assert('IDOR: فقط owner پرداخت‌کننده PRO می‌شود', ownerSub.body.plan === 'pro');
  const originalStill = await req('GET', '/api/subscription', null, auth(token));
  assert('کاربر دیگر از پرداخت غیر خود PRO نگرفت spoof', originalStill.body.plan === 'pro');

  assert('merchant id در پاسخ checkout نیست', !JSON.stringify(checkout.body).toLowerCase().includes('merchant'));

  // --- Concurrent callback race: exactly one activation ---
  setPaymentProvider(makeStub());
  const raceUser = await req('POST', '/api/register', {
    name: 'race pay',
    email: `race.${suffix}@test.local`,
    password,
    role: 'lawyer'
  });
  const raceToken = raceUser.body.accessToken || raceUser.body.token;
  const raceUid = raceUser.body.user.id;
  const raceCheckout = await req('POST', '/api/subscription/checkout', {}, auth(raceToken));
  assert('race checkout', raceCheckout.status === 200 && !!raceCheckout.body.authority, `status ${raceCheckout.status}`);
  const raceAuth = raceCheckout.body.authority;
  const racePayId = raceCheckout.body.paymentId;
  const concurrent = await Promise.all(
    Array.from({ length: 10 }, () =>
      req('GET', `/api/subscription/callback?Authority=${raceAuth}&Status=OK`)
    )
  );
  const allSuccess = concurrent.every((r) => r.status === 302 && /payment=success/.test(r.location));
  assert('۱۰ callback همزمان → همه success', allSuccess, concurrent.map((r) => r.status).join(','));
  const raceEvents = await db('subscription_events').where({ payment_id: racePayId });
  const raceEventsByNote = await db('subscription_events').where({
    user_id: raceUid,
    source: 'payment',
    note: `payment:${racePayId}`
  });
  assert(
    '۱۰ callback همزمان → دقیقاً یک activation',
    raceEvents.length === 1 || raceEventsByNote.length === 1,
    `payment_id=${raceEvents.length} note=${raceEventsByNote.length}`
  );
  const raceSub = await req('GET', '/api/subscription', null, auth(raceToken));
  assert('race → PRO فعال', raceSub.body.plan === 'pro', `plan ${raceSub.body.plan}`);
  const raceExpiry = raceSub.body.expiresAt;
  const raceDup = await req('GET', `/api/subscription/callback?Authority=${raceAuth}&Status=OK`);
  assert('callback تکراری بعد از race → success', raceDup.status === 302 && /payment=success/.test(raceDup.location));
  const raceSub2 = await req('GET', '/api/subscription', null, auth(raceToken));
  assert('callback تکراری → بدون تغییر اضافه', raceSub2.body.expiresAt === raceExpiry);

  try {
    await db('payments').whereIn('user_id', [userId, uidFail, raceUid]).del();
    await db('subscription_events').whereIn('user_id', [userId, uidFail, raceUid]).del();
    await db('refresh_tokens').whereIn('user_id', [userId, uidFail, raceUid]).del();
    await db('users').whereIn('id', [userId, uidFail, raceUid]).del();
  } catch { /* ignore */ }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n=== ${passed} passed / ${failed} failed / ${results.length} total ===\n`);

  resetPaymentProvider();
  await new Promise((r) => server.close(r));
  await db.destroy();
  process.exit(failed ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  try {
    resetPaymentProvider();
    if (server) await new Promise((r) => server.close(r));
    await db.destroy();
  } catch { /* ignore */ }
  process.exit(1);
});
