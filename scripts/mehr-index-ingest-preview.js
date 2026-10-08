/**
 * Preview ingest: normalize audit fixture to schema rows (stdout JSON). No DB write.
 */
const fs = require('fs');
const path = require('path');
const { normalizeFixtureRow } = require('../src/services/legalTools/mehrIndex/schema');
const { validateMehrAuditFixture } = require('../src/services/legalTools/mehrIndex/fixtureValidate');

const FIXTURE = path.join(__dirname, 'fixtures', 'mehr-index-audit.json');
const ingestedAt = new Date().toISOString();

const raw = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const validation = validateMehrAuditFixture(raw);
if (!validation.ok) {
  console.error('Fixture invalid:', validation.errors.join('; '));
  process.exit(1);
}

const rows = raw.map((r) => normalizeFixtureRow(r, ingestedAt));
process.stdout.write(JSON.stringify({ count: rows.length, ingestedAt, rows }, null, 2));
