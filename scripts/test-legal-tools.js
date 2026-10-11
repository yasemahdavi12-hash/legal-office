/**
 * Legal tools — unit calculators, API, static UI markers.
 */
require('dotenv').config();
process.env.MEHR_CALC_ALLOW_TEST_DATASET = '1';

const fs = require('fs');
const path = require('path');
const http = require('http');
const db = require('../src/db/connection');
const { createApp } = require('../src/app');
const calculators = require('../src/services/legalTools/calculators');
const { AppError } = require('../src/utils/response');
const { loadTestFixtureStore } = require('../src/services/legalTools/mehrIndex/indexStore');
const { calculateMehrPure } = require('../src/services/legalTools/mehrIndex/calculatePure');
const mehrIndexService = require('../src/services/legal/mehrIndex.service');

const testMehrStore = loadTestFixtureStore();

let PORT = 0;
let server;
const results = [];

function assert(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

function expectAppError(name, fn) {
  try {
    fn();
    assert(name, false, 'no throw');
  } catch (e) {
    assert(name, e instanceof AppError, e.message || String(e));
  }
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
          try {
            json = raw ? JSON.parse(raw) : null;
          } catch {
            json = { raw };
          }
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
  const email = `lt.${tag}.${Date.now()}@test.local`;
  const password = 'LtLawyerPass99';
  await req('POST', '/api/register', { name: 'LT ' + tag, email, password, role: 'lawyer' });
  const login = await req('POST', '/api/login', { email, password });
  return { email, token: login.body.accessToken };
}

function runDeadlineAddUnitTests() {
  const plus1 = calculators.deadlineAdd({ startDate: '2026-03-01', daysToAdd: 1 });
  assert('deadline +1 day', plus1.endDate === '2026-03-02', plus1.endDate);

  const minus1 = calculators.deadlineAdd({ startDate: '2026-03-02', daysToAdd: -1 });
  assert('deadline -1 day', minus1.endDate === '2026-03-01', minus1.endDate);

  const zero = calculators.deadlineAdd({ startDate: '2026-05-10', daysToAdd: 0 });
  assert('deadline 0 days', zero.endDate === '2026-05-10', zero.endDate);

  const leap = calculators.deadlineAdd({ startDate: '2024-02-28', daysToAdd: 1 });
  assert('deadline leap year', leap.endDate === '2024-02-29', leap.endDate);

  expectAppError('deadline invalid date', () =>
    calculators.deadlineAdd({ startDate: '2023-02-29', daysToAdd: 1 })
  );
  expectAppError('deadline invalid days float', () =>
    calculators.deadlineAdd({ startDate: '2026-01-01', daysToAdd: 1.5 })
  );
  expectAppError('deadline missing start', () => calculators.deadlineAdd({ daysToAdd: 1 }));

  const max = calculators.deadlineAdd({ startDate: '2026-01-01', daysToAdd: calculators.DEADLINE_DAY_LIMIT });
  assert('deadline boundary +36500', max.endDate.length === 10, max.endDate);

  const min = calculators.deadlineAdd({ startDate: '2026-01-01', daysToAdd: -calculators.DEADLINE_DAY_LIMIT });
  assert('deadline boundary -36500', min.endDate.length === 10, min.endDate);

  expectAppError('deadline over boundary', () =>
    calculators.deadlineAdd({ startDate: '2026-01-01', daysToAdd: calculators.DEADLINE_DAY_LIMIT + 1 })
  );
  expectAppError('deadline under boundary', () =>
    calculators.deadlineAdd({ startDate: '2026-01-01', daysToAdd: -calculators.DEADLINE_DAY_LIMIT - 1 })
  );
}

function runDateDiffUnitTests() {
  const same = calculators.dateDiff({ dateFrom: '2026-06-15', dateTo: '2026-06-15' });
  assert('date-diff same date', same.absDays === 0 && same.days === 0, String(same.absDays));

  const next = calculators.dateDiff({ dateFrom: '2026-02-01', dateTo: '2026-02-03' });
  assert('date-diff next day', next.absDays === 2 && next.direction === 'forward', String(next.absDays));

  const rev = calculators.dateDiff({ dateFrom: '2026-02-03', dateTo: '2026-02-01' });
  assert('date-diff reverse', rev.absDays === 2 && rev.direction === 'backward', rev.direction);

  const leap = calculators.dateDiff({ dateFrom: '2024-02-28', dateTo: '2024-03-01' });
  assert('date-diff leap day', leap.absDays === 2, String(leap.absDays));

  const multi = calculators.dateDiff({ dateFrom: '2020-01-01', dateTo: '2026-01-01' });
  assert('date-diff multi-year', multi.absDays === 2192, String(multi.absDays));

  expectAppError('date-diff invalid from', () =>
    calculators.dateDiff({ dateFrom: 'not-a-date', dateTo: '2026-01-01' })
  );
  expectAppError('date-diff invalid feb29', () =>
    calculators.dateDiff({ dateFrom: '2023-02-29', dateTo: '2026-01-01' })
  );
  expectAppError('date-diff missing to', () => calculators.dateDiff({ dateFrom: '2026-01-01' }));

  const dst = calculators.dateDiff({ dateFrom: '2024-03-09', dateTo: '2024-03-11' });
  assert('date-diff DST-safe (UTC noon)', dst.absDays === 2, String(dst.absDays));
}

function runDelayInterestUnitTests() {
  const intr = calculators.delayInterestUserRate({ principal: 1000000, annualRatePercent: 18, days: 365 });
  assert('delay interest normal', Math.abs(intr.interestAmount - 180000) < 1 && intr.totalAmount === 1180000, String(intr.totalAmount));

  const zeroDays = calculators.delayInterestUserRate({ principal: 5000, annualRatePercent: 10, days: 0 });
  assert('delay zero days', zeroDays.interestAmount === 0 && zeroDays.totalAmount === 5000, String(zeroDays.totalAmount));

  const zeroRate = calculators.delayInterestUserRate({ principal: 1000, annualRatePercent: 0, days: 100 });
  assert('delay zero rate', zeroRate.interestAmount === 0 && zeroRate.totalAmount === 1000, String(zeroRate.interestAmount));

  expectAppError('delay negative rate', () =>
    calculators.delayInterestUserRate({ principal: 1000, annualRatePercent: -1, days: 10 })
  );
  expectAppError('delay invalid principal', () =>
    calculators.delayInterestUserRate({ principal: 0, annualRatePercent: 5, days: 10 })
  );
  expectAppError('delay invalid days', () =>
    calculators.delayInterestUserRate({ principal: 1000, annualRatePercent: 5, days: 1.5 })
  );

  const dec = calculators.delayInterestUserRate({ principal: 10000, annualRatePercent: 18.5, days: 30 });
  assert('delay decimal rate', dec.interestAmount > 0 && dec.totalAmount > dec.principal, String(dec.interestAmount));

  const large = calculators.delayInterestUserRate({
    principal: 999999999999,
    annualRatePercent: 1000,
    days: 365
  });
  assert('delay large values', large.interestAmount > 0 && large.totalAmount > large.principal, String(large.interestAmount));

  expectAppError('delay negative days', () =>
    calculators.delayInterestUserRate({ principal: 1000, annualRatePercent: 5, days: -1 })
  );
}

function runMehrUnitTests() {
  const r = calculateMehrPure(
    {
      amount: 1_000_000,
      currency: 'IRR',
      contractYear: 1390,
      basisType: 'payment',
      paymentYear: 1400
    },
    testMehrStore,
    'test-mehr-index-fixture-v1'
  );
  assert('mehr unit fixture calc', r.calculatedAmount === 2_000_000, String(r.calculatedAmount));

  expectAppError('mehr unit invalid currency', () =>
    calculateMehrPure(
      { amount: 1, currency: 'USD', contractYear: 1390, basisType: 'payment', paymentYear: 1400 },
      testMehrStore
    )
  );

  expectAppError('mehr unit zero amount', () =>
    calculateMehrPure(
      { amount: 0, currency: 'IRR', contractYear: 1390, basisType: 'payment', paymentYear: 1400 },
      testMehrStore
    )
  );

  expectAppError('mehr unit incomplete payment', () =>
    calculateMehrPure(
      { amount: 1, currency: 'IRR', contractYear: 1390, basisType: 'payment' },
      testMehrStore
    )
  );
}

function runUiStaticTests() {
  const htmlPath = path.join(__dirname, '..', 'legal-tools.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  assert('UI disclaimer date-diff', html.includes('جایگزین محاسبه مهلت قانونی یا تعطیلات رسمی نیست'));
  assert('UI deadline hint', html.includes('مدت مهلت را بر حسب تعداد روز'));
  assert('UI validateClient', html.includes('function validateClient'));
  assert('UI renderResultHtml', html.includes('function renderResultHtml'));
  assert('UI mobile media query', html.includes('@media(max-width:640px)'));
  assert('UI totalAmount label', html.includes('جمع (اصل + سود)'));
  assert('UI mehr form amount id', html.includes('id="in-mehr-amount"'));
  assert('UI mehr currency id', html.includes('id="in-mehr-currency"'));
  assert('UI mehr contract year', html.includes('id="in-mehr-contract-year"'));
  assert('UI mehr payment year', html.includes('id="in-mehr-payment-year"'));
  assert('UI mehr death date', html.includes('id="in-mehr-death-date"'));
  assert('UI mehr payment fields', html.includes('id="mehr-payment-fields"'));
  assert('UI mehr death fields', html.includes('id="mehr-death-fields"'));
  assert('UI mehr coverage notice', html.includes('id="mehr-coverage-notice"') && html.includes('وجه رایج'));
  assert('UI mehr payment date', html.includes('id="in-mehr-payment-date"'));
  assert('UI mehr dataset empty msg', html.includes('داده رسمی برای این محاسبه هنوز در سامانه ثبت نشده است'));
  assert('UI mehr missing year msg', html.includes('اطلاعات شاخص رسمی برای سال'));
  assert('UI mehr INDEX_NOT_AVAILABLE code', html.includes("INDEX_NOT_AVAILABLE"));
  assert('UI mehr formatMehrIndexError', html.includes('function formatMehrIndexError'));
  assert('UI mehr coin inactive', html.includes('محاسبه مهریه سکه هنوز فعال نیست'));
  assert('UI mehr result container', html.includes('id="mehr-result-container"'));
  assert('UI mehr disclaimer', html.includes('جایگزین مشاوره حقوقی یا تصمیم مرجع قضایی نیست'));
  assert('UI mehr coin disclaimer', html.includes('۱۱۰ سکه') && html.includes('محاسبه نمی‌شود'));
  assert('UI mehr clear on error', html.includes("document.getElementById('tool-result').hidden = true"));
  assert('UI no coin input field', !html.includes('in-mehr-coin'));
  assert('UI basis tadieh label', html.includes('تأدیه'));
}

async function seedTestMehrIndices(knex) {
  const hasTable = await knex.schema.hasTable('legal_annual_indices');
  if (!hasTable) return;
  await knex('legal_annual_indices').where('dataset_version', 'test-mehr-index-fixture-v1').del();
  const fixture = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'tests/fixtures/mehr-index-fixture.json'), 'utf8')
  );
  for (const row of fixture.rows) {
    await knex('legal_annual_indices').insert({
      calendar_system: 'jalali',
      year: row.year,
      average_index: row.averageIndex,
      source_name: 'TEST ONLY',
      dataset_version: fixture.datasetVersion
    });
  }
}

async function main() {
  runDeadlineAddUnitTests();
  runDateDiffUnitTests();
  runDelayInterestUnitTests();
  runMehrUnitTests();
  runUiStaticTests();

  await db.migrate.latest();
  await seedTestMehrIndices(db);
  mehrIndexService.resetStoreCache();
  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  PORT = server.address().port;

  const lawyer = await registerLawyer('a');

  const list = await req('GET', '/api/legal-tools', null, auth(lawyer.token));
  assert('GET catalog 200', list.status === 200);
  assert('catalog has ready tools', (list.body.tools || []).some((t) => t.slug === 'date-diff' && t.status === 'ready'));
  assert(
    'catalog mehr-calc coming_soon',
    (list.body.tools || []).some((t) => t.slug === 'mehr-calc' && t.status === 'coming_soon')
  );

  const detail = await req('GET', '/api/legal-tools/deadline-add', null, auth(lawyer.token));
  assert('GET detail deadline-add', detail.status === 200 && detail.body.slug === 'deadline-add');

  const detail404 = await req('GET', '/api/legal-tools/no-such-tool', null, auth(lawyer.token));
  assert('GET detail 404', detail404.status === 404);

  const calcDd = await req(
    'POST',
    '/api/legal-tools/date-diff/calculate',
    { dateFrom: '2026-02-01', dateTo: '2026-02-03' },
    auth(lawyer.token)
  );
  assert('API date-diff', calcDd.status === 200 && calcDd.body.result?.absDays === 2);

  const calcDl = await req(
    'POST',
    '/api/legal-tools/deadline-add/calculate',
    { startDate: '2026-01-01', daysToAdd: -1 },
    auth(lawyer.token)
  );
  assert('API deadline-add', calcDl.status === 200 && calcDl.body.result?.endDate === '2025-12-31');

  const calcInt = await req(
    'POST',
    '/api/legal-tools/delay-interest-user-rate/calculate',
    { principal: 10000, annualRatePercent: 10, days: 0 },
    auth(lawyer.token)
  );
  assert(
    'API delay-interest',
    calcInt.status === 200 && calcInt.body.result?.totalAmount === 10000 && calcInt.body.result?.note?.includes('نرخ واردشده')
  );

  const badDd = await req(
    'POST',
    '/api/legal-tools/date-diff/calculate',
    { dateFrom: '', dateTo: '2026-01-01' },
    auth(lawyer.token)
  );
  assert('API date-diff validation 400', badDd.status === 400);

  const mehrDetail = await req('GET', '/api/legal-tools/mehr-calc', null, auth(lawyer.token));
  assert(
    'GET detail mehr-calc',
    mehrDetail.status === 200 &&
      mehrDetail.body.slug === 'mehr-calc' &&
      mehrDetail.body.status === 'coming_soon'
  );

  const mehrBlocked = await req(
    'POST',
    '/api/legal-tools/mehr-calc/calculate',
    {
      amount: 1_000_000,
      currency: 'IRR',
      contractYear: 1390,
      basisType: 'payment',
      paymentYear: 1400
    },
    auth(lawyer.token)
  );
  assert(
    'API mehr TOOL_NOT_READY',
    mehrBlocked.status === 400 &&
      mehrBlocked.body.details?.code === 'TOOL_NOT_READY' &&
      !mehrBlocked.body.result
  );

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
