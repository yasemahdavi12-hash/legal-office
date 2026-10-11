/**
 * Dedicated mehr-calc test runner: fixture validation, pure calc, UI static, API smoke.
 */
require('dotenv').config();
process.env.MEHR_CALC_ALLOW_TEST_DATASET = '1';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const http = require('http');
const db = require('../src/db/connection');
const { createApp } = require('../src/app');
const mehrIndexService = require('../src/services/legal/mehrIndex.service');

const root = path.join(__dirname, '..');
const results = [];

function assert(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

function req(port, method, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : JSON.stringify(body);
    const r = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: urlPath,
        method,
        headers: {
          ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
          ...headers
        }
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => {
          raw += c;
        });
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

async function registerLawyer(port) {
  const email = `mehr.${Date.now()}@test.local`;
  const password = 'MehrLawyerPass99';
  await req(port, 'POST', '/api/register', { name: 'Mehr Test', email, password, role: 'lawyer' });
  const login = await req(port, 'POST', '/api/login', { email, password });
  return login.body.accessToken;
}

async function seedTestMehrIndices(knex) {
  const hasTable = await knex.schema.hasTable('legal_annual_indices');
  if (!hasTable) return;
  await knex('legal_annual_indices').where('dataset_version', 'test-mehr-index-fixture-v1').del();
  const fixture = JSON.parse(
    fs.readFileSync(path.join(root, 'tests/fixtures/mehr-index-fixture.json'), 'utf8')
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

function runUiStaticTests() {
  const html = fs.readFileSync(path.join(root, 'legal-tools.html'), 'utf8');
  assert('UI coverage notice', html.includes('id="mehr-coverage-notice"') && html.includes('وجه رایج'));
  assert('UI payment date field', html.includes('id="in-mehr-payment-date"'));
  assert('UI INDEX_NOT_AVAILABLE handler', html.includes("details?.code === 'INDEX_NOT_AVAILABLE'"));
  assert('UI result amountInRial', html.includes('r.amountInRial'));
  assert('UI appliedIndexYearNumerator', html.includes('appliedIndexYearNumerator'));
  assert('UI coin disclaimer', html.includes('۱۱۰ سکه') && html.includes('محاسبه نمی‌شود'));
  assert('UI payment conflict validation', html.includes('فقط یکی از تاریخ پرداخت یا سال پرداخت'));
  assert('UI basis sync disable', html.includes('el.disabled = !isPay'));
  assert('UI dataset empty message', html.includes('داده رسمی برای این محاسبه هنوز در سامانه ثبت نشده است'));
  assert('UI missing year message', html.includes('اطلاعات شاخص رسمی برای سال'));
  assert('UI coin inactive message', html.includes('محاسبه مهریه سکه هنوز فعال نیست'));
  assert('UI mobile media query', html.includes('@media(max-width:640px)'));
  assert('UI no coin input field', !html.includes('in-mehr-coin'));
}

async function runApiTests(port, token) {
  const auth = { Authorization: 'Bearer ' + token };
  const catalog = await req(port, 'GET', '/api/legal-tools', null, auth);
  const mehr = (catalog.body.tools || []).find((t) => t.slug === 'mehr-calc');
  assert('API catalog mehr coming_soon', mehr?.status === 'coming_soon');

  const blocked = await req(
    port,
    'POST',
    '/api/legal-tools/mehr-calc/calculate',
    {
      amount: 1_000_000,
      currency: 'IRR',
      contractYear: 1390,
      basisType: 'payment',
      paymentYear: 1400
    },
    auth
  );
  assert(
    'API TOOL_NOT_READY (no fake result)',
    blocked.status === 400 &&
      blocked.body.details?.code === 'TOOL_NOT_READY' &&
      blocked.body.result == null
  );

  const detail = await req(port, 'GET', '/api/legal-tools/mehr-calc', null, auth);
  assert(
    'GET detail mehr-calc',
    detail.status === 200 && detail.body.slug === 'mehr-calc' && detail.body.status === 'coming_soon'
  );
}

async function main() {
  console.log('--- fixture + pure ---');
  execSync('node scripts/test-mehr-index-fixture.js', { cwd: root, stdio: 'inherit' });
  execSync('node scripts/test-mehr-calc-pure.js', { cwd: root, stdio: 'inherit' });
  execSync('node scripts/test-mehr-ingest.js', { cwd: root, stdio: 'inherit' });

  runUiStaticTests();

  await db.migrate.latest();
  await seedTestMehrIndices(db);
  mehrIndexService.resetStoreCache();

  const app = createApp();
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const token = await registerLawyer(port);
  await runApiTests(port, token);
  server.close();

  const failed = results.filter((r) => !r.ok);
  console.log('\n---');
  console.log(`mehr-calc: ${results.length - failed.length}/${results.length} PASS (UI+API)`);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
