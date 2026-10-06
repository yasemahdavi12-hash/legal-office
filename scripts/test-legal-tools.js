/**
 * Legal tools — catalog auth, calculators, client blocked.
 */
require('dotenv').config();

const http = require('http');
const db = require('../src/db/connection');
const { createApp } = require('../src/app');
const calculators = require('../src/services/legalTools/calculators');
const { AppError } = require('../src/utils/response');

let PORT = 0;
let server;
const results = [];

function assert(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

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

function auth(token) {
  return { Authorization: 'Bearer ' + token };
}

async function registerLawyer(tag) {
  const email = `lt.${tag}@test.local`;
  const password = 'LtLawyerPass99';
  await req('POST', '/api/register', { name: 'LT ' + tag, email, password, role: 'lawyer' });
  const login = await req('POST', '/api/login', { email, password });
  return { email, token: login.body.accessToken };
}

async function main() {
  // Unit calculators
  const dd = calculators.dateDiff({ dateFrom: '2026-01-01', dateTo: '2026-01-11' });
  assert('date-diff 10 days', dd.absDays === 10, String(dd.absDays));

  const dl = calculators.deadlineAdd({ startDate: '2026-01-01', daysToAdd: 20 });
  assert('deadline-add endDate', dl.endDate === '2026-01-21', dl.endDate);

  const intr = calculators.delayInterestUserRate({ principal: 1000000, annualRatePercent: 18, days: 365 });
  assert('delay interest ~18%', Math.abs(intr.interestAmount - 180000) < 1, String(intr.interestAmount));

  try {
    calculators.dateDiff({ dateFrom: 'bad', dateTo: '2026-01-01' });
    assert('invalid date throws', false);
  } catch (e) {
    assert('invalid date throws', e instanceof AppError);
  }

  await db.migrate.latest();
  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  PORT = server.address().port;

  const lawyer = await registerLawyer('a');
  const list = await req('GET', '/api/legal-tools', null, auth(lawyer.token));
  assert('GET catalog 200', list.status === 200);
  assert('catalog has ready tools', (list.body.tools || []).some((t) => t.slug === 'date-diff' && t.status === 'ready'));

  const calc = await req(
    'POST',
    '/api/legal-tools/date-diff/calculate',
    { dateFrom: '2026-02-01', dateTo: '2026-02-03' },
    auth(lawyer.token)
  );
  assert('calculate date-diff', calc.status === 200 && calc.body.result?.absDays === 2);

  const soon = await req('POST', '/api/legal-tools/mehr-calc/calculate', {}, auth(lawyer.token));
  assert('coming_soon rejected', soon.status === 400);

  const noAuth = await req('GET', '/api/legal-tools');
  assert('no auth 401', noAuth.status === 401);

  const pages = await Promise.all([
    req('GET', '/legal-tools'),
    req('GET', '/laws'),
    req('GET', '/lawyer-modules.js')
  ]);
  assert('HTML legal-tools served', pages[0].status === 200);
  assert('HTML laws served', pages[1].status === 200);
  assert('lawyer-modules.js served', pages[2].status === 200 && String(pages[2].body?.raw || '').includes('LawyerModules'));

  server.close();
  const failed = results.filter((r) => !r.ok);
  console.log('\n' + (failed.length ? 'FAIL' : 'PASS') + `  legal-tools ${results.filter((r) => r.ok).length}/${results.length}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
