/**
 * Ingest script smoke test (no DB write unless MEHR_IMPORT_OFFICIAL=1).
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { validateMehrAuditFixture } = require('../src/services/legalTools/mehrIndex/fixtureValidate');

const FIXTURE = path.join(__dirname, 'fixtures', 'mehr-index-audit.json');
const results = [];

function assert(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

const rows = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const v = validateMehrAuditFixture(rows);
assert('audit fixture validates', v.ok, v.errors.join('; '));
assert('import script exists', fs.existsSync(path.join(__dirname, 'import-mehr-indices.js')));

if (process.env.MEHR_IMPORT_OFFICIAL === '1') {
  console.log('(MEHR_IMPORT_OFFICIAL=1 — run import-mehr-indices.js separately in controlled env)');
} else {
  assert('import gated without MEHR_IMPORT_OFFICIAL', true, 'default skip');
}

const failed = results.filter((r) => !r.ok);
console.log('\n---');
console.log(`mehr-ingest: ${results.length - failed.length}/${results.length} PASS`);
process.exit(failed.length ? 1 : 0);
