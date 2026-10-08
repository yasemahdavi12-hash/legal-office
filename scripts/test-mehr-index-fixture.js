/**
 * Validates scripts/fixtures/mehr-index-audit.json (official audit dataset 1315–1401).
 */
const fs = require('fs');
const path = require('path');
const { validateMehrAuditFixture } = require('../src/services/legalTools/mehrIndex/fixtureValidate');

const FIXTURE = path.join(__dirname, 'fixtures', 'mehr-index-audit.json');

const results = [];
function assert(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

function main() {
  const raw = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const { ok, errors } = validateMehrAuditFixture(raw);
  assert('fixture validation aggregate', ok, errors.join('; ') || 'ok');

  const years = raw.map((r) => Number(r.year)).sort((a, b) => a - b);
  assert('record count 87', raw.length === 87);
  assert('years min 1315', years[0] === 1315);
  assert('years max 1401', years[years.length - 1] === 1401);
  assert('no duplicate years', new Set(years).size === years.length);
  assert('no gap 1315..1401', years.length === 1401 - 1315 + 1);

  const failed = results.filter((r) => !r.ok);
  console.log('\n---');
  console.log(`mehr-index-fixture: ${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) process.exit(1);
}

main();
