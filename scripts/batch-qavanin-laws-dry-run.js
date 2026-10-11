/**
 * Batch fetch + parse + validate HIGH confidence civil-compatible laws (dry-run JSON only).
 * No DB / API / import.
 *
 * Usage:
 *   node scripts/batch-qavanin-laws-dry-run.js
 *   node scripts/batch-qavanin-laws-dry-run.js --skip-fetch   (use cached border-text per law)
 *   node scripts/batch-qavanin-laws-dry-run.js --only civil-procedure,cheque
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { parseBorderText } = require('./lib/qavanin-border-parser');
const { buildImportDocument, PARSER_VERSION } = require('./lib/qavanin-civil-import');
const { fetchBorderText, minTextLengthForLaw } = require('./lib/qavanin-fetch');
const { applyBookPrefixIfNeeded, analyzeStructure } = require('./lib/qavanin-structure-analysis');
const { applyCommerceHierarchyPrefix } = require('./lib/qavanin-hierarchy-prefix');
const {
  buildLawValidationReport,
  validationReportToMd
} = require('./lib/qavanin-batch-validation');

const CATALOG_PATH = path.join(
  os.tmpdir(),
  'dadbane-qavanin-prototype',
  'dadbane-laws-source-catalog.json'
);
const OUT_DIR = path.join(os.tmpdir(), 'dadbane-qavanin-batch');

/** Execution order (civil-code intentionally omitted — already imported in DEV). */
const BATCH_LAW_KEYS = [
  'civil-procedure',
  'cheque',
  'ipc-1392',
  'ipc-book5',
  'criminal-procedure',
  'direct-tax',
  'commerce',
  'registration',
  'family-protection',
  'labor',
  'social-security',
  'armed-forces-crimes'
];

const CATALOG_LOOKUP_KEY = {
  'ipc-1392': 'ipc'
};

const SYNTHETIC_CATALOG_ENTRIES = {
  'ipc-book5': {
    lawKey: 'ipc-book5',
    title: 'كتاب پنجم قانون مجازات اسلامي — تعزيرات و مجازات‌هاي بازدارنده',
    category: 'ipc',
    approvalDate: '1375-05-02',
    primarySourceUrl: 'https://www.qavanin.ir/Law/TreeText/?IDS=1411571862160201724',
    access: 'ok',
    confidence: 'high',
    parserStrategy: 'civil-compatible with book-aware sortKey extension',
    estimatedUnits: 400,
    articleNumberResets: false,
    prefixNeeded: 'K5 if collisions'
  }
};

const DISPLAY_TITLE = {
  'ipc-1392': 'قانون مجازات اسلامي (كتاب‌هاي 1 تا 4)'
};

function parseArgs(argv) {
  const skipFetch = argv.includes('--skip-fetch');
  const onlyIdx = argv.indexOf('--only');
  let only = null;
  if (onlyIdx >= 0 && argv[onlyIdx + 1]) {
    only = argv[onlyIdx + 1].split(',').map((s) => s.trim()).filter(Boolean);
  }
  return { skipFetch, only };
}

function loadCatalog() {
  if (!fs.existsSync(CATALOG_PATH)) {
    throw new Error(`Catalog not found: ${CATALOG_PATH}`);
  }
  return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
}

function resolveLawEntry(catalog, runLawKey) {
  if (SYNTHETIC_CATALOG_ENTRIES[runLawKey]) {
    return { ...SYNTHETIC_CATALOG_ENTRIES[runLawKey], lawKey: runLawKey };
  }
  const catalogKey = CATALOG_LOOKUP_KEY[runLawKey] || runLawKey;
  const entry = catalog.laws.find((l) => l.lawKey === catalogKey);
  if (!entry) throw new Error(`Catalog missing lawKey=${catalogKey} (run as ${runLawKey})`);
  return { ...entry, lawKey: runLawKey };
}

function articleNumberContractFor(lawKey, prefixApplied) {
  const base =
    'law_articles.article_number = sortKey; 5-digit zero-padded base; -n# tabsera; -r# mokarrar/elhaqi';
  if (lawKey === 'ipc-1392' || lawKey === 'ipc-book5') {
    return prefixApplied
      ? `${base}; optional book prefix K1-..K5- when numbering resets or sortKey collisions`
      : `${base}; ipc: no book prefix applied (continuous numbering / no collision detected)`;
  }
  if (lawKey === 'commerce' && prefixApplied) {
    return `${base}; commerce: B{bb}-F{ff}- prefix from باب/فصل hierarchy`;
  }
  return base;
}

async function processOneLaw(entry, options) {
  const lawKey = entry.lawKey;
  const url = entry.primarySourceUrl;
  if (!url) {
    return {
      lawKey,
      result: 'FAIL',
      error: 'no primarySourceUrl',
      skippedFetch: true
    };
  }

  if (entry.confidence !== 'high' || entry.access !== 'ok') {
    return {
      lawKey,
      result: 'SKIP',
      reason: `confidence=${entry.confidence} access=${entry.access}`
    };
  }

  if (entry.parserStrategy && entry.parserStrategy.startsWith('special-parser')) {
    return { lawKey, result: 'SKIP', reason: 'special-parser' };
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const cacheHtml = path.join(OUT_DIR, `${lawKey}-border-text.html`);
  const cacheMeta = path.join(OUT_DIR, `${lawKey}-fetch-meta.json`);

  let html;
  let fetchedAt;

  if (options.skipFetch && fs.existsSync(cacheHtml)) {
    html = fs.readFileSync(cacheHtml, 'utf8');
    fetchedAt = fs.existsSync(cacheMeta)
      ? JSON.parse(fs.readFileSync(cacheMeta, 'utf8')).fetchedAt
      : fs.statSync(cacheHtml).mtime.toISOString();
    console.log(`[${lawKey}] Using cached BorderText`);
  } else {
    console.log(`[${lawKey}] Fetching ${url}`);
    const minLen = minTextLengthForLaw(entry);
    const fetched = await fetchBorderText(url, { minTextLength: minLen });
    html = fetched.html;
    fetchedAt = fetched.fetchedAt;
    fs.writeFileSync(cacheHtml, html, 'utf8');
    fs.writeFileSync(
      cacheMeta,
      JSON.stringify({ sourceUrl: url, fetchedAt, minTextLength: minLen }, null, 2),
      'utf8'
    );
  }

  let { units, ambiguities } = parseBorderText(html);
  analyzeStructure(html);

  let structureReport;
  let prefixApplied = false;
  if (lawKey === 'commerce') {
    const hierarchy = applyCommerceHierarchyPrefix(units, html);
    units = hierarchy.units;
    structureReport = hierarchy.structureReport;
    prefixApplied = hierarchy.prefixApplied;
  } else {
    const bookAware = lawKey === 'ipc-1392' || lawKey === 'ipc-book5';
    const prefixed = applyBookPrefixIfNeeded(units, html, lawKey, { bookAware });
    units = prefixed.units;
    structureReport = prefixed.structureReport;
    prefixApplied = prefixed.prefixApplied;
  }

  const title = DISPLAY_TITLE[lawKey] || entry.title;
  const doc = buildImportDocument({
    units,
    sourceUrl: url,
    fetchedAt,
    titleOnSite: entry.title,
    lawKey,
    title,
    category: entry.category,
    approvalDate: entry.approvalDate,
    articleNumberContract: articleNumberContractFor(lawKey, prefixApplied)
  });

  const jsonPath = path.join(OUT_DIR, `${lawKey}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(doc, null, 0), 'utf8');

  const validation = buildLawValidationReport({
    lawKey,
    doc,
    units,
    ambiguities,
    structureReport,
    parserVersion: PARSER_VERSION
  });

  const valJsonPath = path.join(OUT_DIR, `${lawKey}-validation.json`);
  const valMdPath = path.join(OUT_DIR, `${lawKey}-validation.md`);
  fs.writeFileSync(valJsonPath, JSON.stringify(validation, null, 2), 'utf8');
  fs.writeFileSync(
    valMdPath,
    validationReportToMd(validation, `${title} — batch validation`),
    'utf8'
  );

  console.log(
    `[${lawKey}] ${validation.result} — units=${validation.totals.units} ambiguities=${validation.validation.parseAmbiguityCount}`
  );

  return {
    lawKey,
    title,
    result: validation.result,
    units: validation.totals.units,
    parseAmbiguityCount: validation.validation.parseAmbiguityCount,
    duplicateCount: validation.validation.duplicateCount,
    emptyContent: validation.validation.emptyContent,
    uiPollution: validation.validation.uiPollution,
    prefixApplied: structureReport?.prefixApplied || false,
    structureNotes: structureReport?.prefixNotes || [],
    bookMarkers: structureReport?.bookMarkers?.length || 0,
    jsonPath,
    validationPath: valJsonPath,
    needsParserFix:
      validation.result === 'FAIL' &&
      (validation.validation.parseAmbiguityCount > 0 ||
        validation.validation.duplicateCount > 0 ||
        validation.validation.uiPollution > 0)
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const catalog = loadCatalog();

  let keys = BATCH_LAW_KEYS;
  if (args.only) keys = args.only;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log('Catalog:', CATALOG_PATH);
  console.log('Output:', OUT_DIR);
  console.log('Laws to run:', keys.join(', '));

  const results = [];
  for (const runKey of keys) {
    try {
      const entry = resolveLawEntry(catalog, runKey);
      const row = await processOneLaw(entry, { skipFetch: args.skipFetch });
      results.push(row);
    } catch (err) {
      console.error(`[${runKey}] ERROR`, err.message);
      results.push({ lawKey: runKey, result: 'FAIL', error: err.message });
    }
  }

  const executed = results.filter((r) => r.result === 'PASS' || r.result === 'FAIL');
  const pass = results.filter((r) => r.result === 'PASS');
  const fail = results.filter((r) => r.result === 'FAIL');
  const skipped = results.filter((r) => r.result === 'SKIP');

  const summary = {
    generatedAt: new Date().toISOString(),
    catalogPath: CATALOG_PATH,
    outputDir: OUT_DIR,
    parserVersion: PARSER_VERSION,
    executedCount: executed.length,
    passCount: pass.length,
    failCount: fail.length,
    skipCount: skipped.length,
    ipcStructure: results
      .filter((r) => r.lawKey === 'ipc-1392' || r.lawKey === 'ipc-book5')
      .map((r) => ({
        lawKey: r.lawKey,
        result: r.result,
        prefixApplied: r.prefixApplied,
        bookMarkers: r.bookMarkers,
        notes: r.structureNotes
      })),
    laws: results,
    parserFixRecommended: fail
      .filter((r) => r.needsParserFix || r.parseAmbiguityCount > 0)
      .map((r) => r.lawKey)
  };

  const summaryJson = path.join(OUT_DIR, 'batch-summary.json');
  const summaryMd = path.join(OUT_DIR, 'batch-summary.md');
  fs.writeFileSync(summaryJson, JSON.stringify(summary, null, 2), 'utf8');

  const md = [
    '# Qavanin batch dry-run summary',
    '',
    `Generated: ${summary.generatedAt}`,
    `Output: ${OUT_DIR}`,
    '',
    '## Counts',
    '',
    `- executed: ${summary.executedCount}`,
    `- PASS: ${summary.passCount}`,
    `- FAIL: ${summary.failCount}`,
    `- SKIP: ${summary.skipCount}`,
    '',
    '## Per law',
    '',
    '| lawKey | result | units | ambiguities | prefix |',
    '|--------|--------|-------|-------------|--------|'
  ];
  for (const r of results) {
    md.push(
      `| ${r.lawKey || '?'} | ${r.result} | ${r.units ?? '—'} | ${r.parseAmbiguityCount ?? '—'} | ${r.prefixApplied ? 'yes' : 'no'} |`
    );
  }
  if (summary.parserFixRecommended.length) {
    md.push('', '## Parser fix recommended', '');
    for (const k of summary.parserFixRecommended) md.push(`- ${k}`);
  }
  if (summary.ipcStructure.length) {
    md.push('', '## IPC structure', '');
    for (const ipc of summary.ipcStructure) {
      md.push(`### ${ipc.lawKey} (${ipc.result})`);
      md.push(`- book markers: ${ipc.bookMarkers}`);
      md.push(`- prefix applied: ${ipc.prefixApplied}`);
      for (const n of ipc.notes || []) md.push(`- ${n}`);
      md.push('');
    }
  }
  fs.writeFileSync(summaryMd, md.join('\n'), 'utf8');

  console.log('\n=== Batch complete ===');
  console.log('Executed:', summary.executedCount, 'PASS:', summary.passCount, 'FAIL:', summary.failCount);
  console.log('Artifacts:', OUT_DIR);
  console.log('Summary:', summaryJson);

  process.exit(fail.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
