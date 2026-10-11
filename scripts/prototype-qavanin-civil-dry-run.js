/**
 * Dry-run: parser units → civil-code-import JSON + validation v2. No DB writes.
 *
 * Usage: node scripts/prototype-qavanin-civil-dry-run.js
 * Requires: border-text.html or border-text.txt in temp (run prototype fetch first).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { parseBorderText } = require('./lib/qavanin-border-parser');
const {
  buildImportDocument,
  countJsonTypes,
  validateImportJson,
  validateCoreSamples,
  validateRandomSamples,
  PARSER_VERSION
} = require('./lib/qavanin-civil-import');

const SOURCE_URL =
  'https://www.qavanin.ir/Law/TreeText/?IDS=12021850837713548188';
const OUT_DIR = path.join(os.tmpdir(), 'dadbane-qavanin-prototype');
const JSON_PATH = path.join(OUT_DIR, 'civil-code-import-dry-run.json');
const REPORT_JSON = path.join(OUT_DIR, 'validation-report-v2.json');
const REPORT_MD = path.join(OUT_DIR, 'validation-report-v2.md');

function loadRawBorderText() {
  const htmlPath = path.join(OUT_DIR, 'border-text.html');
  const textPath = path.join(OUT_DIR, 'border-text.txt');
  if (fs.existsSync(htmlPath)) {
    return {
      raw: fs.readFileSync(htmlPath, 'utf8'),
      fetchedAt: fs.statSync(htmlPath).mtime.toISOString(),
      from: htmlPath
    };
  }
  if (fs.existsSync(textPath)) {
    return {
      raw: fs.readFileSync(textPath, 'utf8'),
      fetchedAt: fs.statSync(textPath).mtime.toISOString(),
      from: textPath
    };
  }
  throw new Error(
    `No cached BorderText in ${OUT_DIR}. Run: node scripts/prototype-qavanin-civil-parser.js`
  );
}

async function readDbSchemaHint() {
  try {
    const db = require('../src/db/connection');
    const lawsCols = await db('laws').columnInfo();
    const artCols = await db('law_articles').columnInfo();
    return {
      connected: true,
      laws: Object.keys(lawsCols),
      law_articles: Object.keys(artCols),
      note: 'Read-only columnInfo; no writes performed'
    };
  } catch (err) {
    return {
      connected: false,
      error: err.message,
      fromMigration: {
        laws: [
          'id',
          'title',
          'category',
          'approval_date',
          'source',
          'description',
          'created_at',
          'updated_at'
        ],
        law_articles: [
          'id',
          'law_id',
          'article_number',
          'title',
          'content',
          'source',
          'created_at',
          'updated_at'
        ],
        unique: ['law_id', 'article_number']
      }
    };
  }
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const { raw, fetchedAt, from } = loadRawBorderText();
  console.log('Loaded BorderText from:', from);

  const { units, ambiguities } = parseBorderText(raw);
  const doc = buildImportDocument({
    units,
    sourceUrl: SOURCE_URL,
    fetchedAt,
    titleOnSite: 'قانون مدني با اصلاحات و الحاقات بعدی'
  });

  fs.writeFileSync(JSON_PATH, JSON.stringify(doc, null, 0), 'utf8');
  console.log('Wrote JSON:', JSON_PATH);
  console.log('Articles:', doc.articles.length);

  const structural = validateImportJson(doc, units.length);
  const typeCounts = countJsonTypes(doc.articles);
  const coreSamples = validateCoreSamples(doc.articles, units);
  const randomSamples = validateRandomSamples(doc.articles, units, 42);

  const passStructural =
    structural.errors.length === 0 &&
    structural.duplicateCount === 0 &&
    structural.emptyContent === 0 &&
    structural.htmlRemnants === 0 &&
    structural.uiPollution === 0 &&
    structural.secretHits === 0 &&
    structural.orderingErrorCount === 0 &&
    ambiguities.length === 0;

  const passSamples =
    coreSamples.every((s) => s.pass) && randomSamples.every((s) => s.pass);

  const overallPass = passStructural && passSamples;

  return readDbSchemaHint().then((dbSchema) => {
    const report = {
      generatedAt: new Date().toISOString(),
      parserVersion: PARSER_VERSION,
      jsonPath: JSON_PATH,
      sourceRaw: from,
      articleNumberContract: doc.importMeta.articleNumberContract,
      totals: {
        articles: doc.articles.length,
        parserUnits: units.length,
        ...typeCounts
      },
      validation: {
        duplicateCount: structural.duplicateCount,
        emptyContent: structural.emptyContent,
        htmlRemnants: structural.htmlRemnants,
        uiPollution: structural.uiPollution,
        secretHits: structural.secretHits,
        orderingErrorCount: structural.orderingErrorCount,
        orderingErrors: structural.orderingErrors.slice(0, 20),
        structuralErrors: structural.errors,
        parseAmbiguityCount: ambiguities.length,
        parseAmbiguities: ambiguities.slice(0, 20)
      },
      coreSamples,
      randomSamples,
      dbSchema,
      result: overallPass ? 'PASS' : 'FAIL'
    };

    fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), 'utf8');

    const md = [
      '# Civil code import dry-run (v2)',
      '',
      `Result: **${report.result}**`,
      '',
      '## Contract',
      '',
      `- ${doc.importMeta.articleNumberContract}`,
      '- unitType: normal | eslahi | mokarrar | elhaqi | tabsereh',
      '- sort order: numeric base (5 digits), then -n*, then -r*',
      '',
      '## Totals',
      '',
      `- articles: ${report.totals.articles}`,
      `- normal: ${typeCounts.normal}`,
      `- eslahi: ${typeCounts.eslahi}`,
      `- mokarrar: ${typeCounts.mokarrar}`,
      `- elhaqi: ${typeCounts.elhaqi}`,
      `- tabsereh: ${typeCounts.tabsereh}`,
      '',
      '## Validation metrics',
      '',
      `- duplicates: ${structural.duplicateCount}`,
      `- empty content: ${structural.emptyContent}`,
      `- HTML remnants: ${structural.htmlRemnants}`,
      `- UI pollution: ${structural.uiPollution}`,
      `- secrets: ${structural.secretHits}`,
      `- ordering errors: ${structural.orderingErrorCount}`,
      '',
      '## Core samples',
      ''
    ];
    for (const s of coreSamples) {
      md.push(`- **${s.name}**: ${s.pass ? 'PASS' : 'FAIL'}${s.reasons.length ? ` — ${s.reasons.join('; ')}` : ''}`);
    }
    md.push('', '## Random 10 (seed=42)', '');
    for (const s of randomSamples) {
      md.push(`- **${s.name}**: ${s.pass ? 'PASS' : 'FAIL'}${s.reasons.length ? ` — ${s.reasons.join('; ')}` : ''}`);
    }
    fs.writeFileSync(REPORT_MD, md.join('\n'), 'utf8');

    console.log('\n--- Dry-run validation v2 ---');
    console.log('Result:', report.result);
    console.log('Types:', typeCounts);
    console.log('Duplicates / empty / HTML / UI / ordering:',
      structural.duplicateCount,
      structural.emptyContent,
      structural.htmlRemnants,
      structural.uiPollution,
      structural.orderingErrorCount
    );
    for (const s of coreSamples) {
      console.log(`${s.pass ? 'PASS' : 'FAIL'}  ${s.name}`);
    }
    console.log('Reports:', REPORT_JSON, REPORT_MD);

    if (dbSchema.connected) {
      console.log('DB (read-only): law_articles columns:', dbSchema.law_articles.join(', '));
    }

    process.exit(overallPass ? 0 : 1);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
