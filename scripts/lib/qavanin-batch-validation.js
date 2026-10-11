/**
 * Batch dry-run validation for qavanin import JSON (no DB).
 */
const {
  countJsonTypes,
  validateImportJson,
  UNIT_TYPE_TO_JSON
} = require('./qavanin-civil-import');
const { contentHasNestedUnitHeader } = require('./qavanin-border-parser');

const { compareSortKeys } = require('./qavanin-civil-import');

function compareSortKeysExtended(a, b) {
  return compareSortKeys(a, b);
}

function validateOrderingExtended(articles) {
  const orderingErrors = [];
  for (let i = 1; i < articles.length; i += 1) {
    if (compareSortKeysExtended(articles[i - 1].sortKey, articles[i].sortKey) > 0) {
      orderingErrors.push(
        `sequential order at index ${i}: ${articles[i - 1].sortKey} before ${articles[i].sortKey}`
      );
      break;
    }
  }
  return orderingErrors;
}

const SHORT_CONTENT_THRESHOLD = 12;

function pickBatchSamples(units, articles, lawKey, structureReport) {
  const samples = [];
  const maddde = units.filter((u) => u.unitType !== 'tabsera');
  const tabsera = units.filter((u) => u.unitType === 'tabsera');

  function pushSample(name, unit) {
    if (!unit) {
      samples.push({ name, pass: false, reasons: ['unit not found'], sortKey: null });
      return;
    }
    const art = articles.find((a) => a.sortKey === unit.sortKey);
    const reasons = [];
    if (!art) reasons.push('missing in JSON');
    else if (art.content !== unit.content) reasons.push('content differs from parser unit');
    if (!unit.content || String(unit.content).trim().length === 0) reasons.push('empty content');
    if (contentHasNestedUnitHeader(unit.content)) {
      reasons.push('nested unit header in content');
    }
    if (unit.content && unit.content.length < SHORT_CONTENT_THRESHOLD && unit.unitType !== 'tabsera') {
      reasons.push(`suspiciously short content (${unit.content.length} chars)`);
    }
    samples.push({
      name,
      pass: reasons.length === 0,
      reasons,
      sortKey: unit.sortKey,
      unitType: UNIT_TYPE_TO_JSON[unit.unitType] || unit.unitType,
      contentLength: unit.content ? unit.content.length : 0
    });
  }

  if (maddde.length > 0) {
    pushSample('first maddde in document order', maddde[0]);
  }

  const withTabsera = maddde.find((m) =>
    tabsera.some((t) => t.baseNumber === m.baseNumber || t.articleNumber === m.articleNumber)
  );
  if (withTabsera) {
    const t = tabsera.find(
      (x) => x.baseNumber === withTabsera.baseNumber || x.articleNumber === withTabsera.articleNumber
    );
    pushSample(`maddde with tabsera (base ${withTabsera.baseNumber})`, withTabsera);
    if (t) pushSample(`tabsera for base ${withTabsera.baseNumber}`, t);
  } else if (tabsera.length) {
    pushSample('first tabsera', tabsera[0]);
  }

  const mid = maddde[Math.floor(maddde.length / 2)];
  if (mid && mid !== maddde[0]) pushSample('middle maddde', mid);

  const nearEnd = maddde[Math.max(0, maddde.length - 3)];
  if (nearEnd && nearEnd !== mid) pushSample('near-end maddde', nearEnd);

  const special = maddde.find(
    (u) => u.unitType === 'mokarrar' || u.unitType === 'elhaqi' || u.unitType === 'amended'
  );
  if (special) pushSample(`special structure (${special.unitType})`, special);

  if (lawKey === 'ipc-1392' || lawKey === 'ipc-book5') {
    const books = structureReport?.bookMarkers || [];
    const seenBook = new Set();
    for (let i = 0; i < books.length; i += 1) {
      const b = books[i];
      if (seenBook.has(b.bookIndex)) continue;
      const endLine = books[i + 1]?.lineIndex ?? Infinity;
      const u = units.find(
        (x) =>
          x.unitType !== 'tabsera' &&
          x.lineIndex >= b.lineIndex &&
          x.lineIndex < endLine
      );
      if (u) {
        pushSample(`IPC book ${b.bookIndex} sample`, u);
        seenBook.add(b.bookIndex);
      }
    }
  }

  return samples;
}

function evaluateLawPass({
  ambiguities,
  structural,
  samples,
  unknownSectionHeaders,
  structureReport
}) {
  const orderingErrors = validateOrderingExtended(
    structural._articlesForOrder || []
  );
  const orderingErrorCount = orderingErrors.length;

  const passStructural =
    structural.errors.length === 0 &&
    structural.duplicateCount === 0 &&
    structural.emptyContent === 0 &&
    structural.uiPollution === 0 &&
    ambiguities.length === 0 &&
    orderingErrorCount === 0;

  const passSamples = samples.length >= 5 && samples.every((s) => s.pass);

  const unknownHeaderCount = (unknownSectionHeaders || []).length;
  const prefixWarnings = (structureReport?.prefixNotes || []).some((n) =>
    /WARNING|unexpected|skipped/.test(n)
  );

  const pass =
    passStructural &&
    passSamples &&
    unknownHeaderCount === 0 &&
    !prefixWarnings &&
    structural.htmlRemnants === 0;

  return {
    pass,
    passStructural,
    passSamples,
    orderingErrors,
    orderingErrorCount,
    unknownHeaderCount
  };
}

function buildLawValidationReport({
  lawKey,
  doc,
  units,
  ambiguities,
  structureReport,
  parserVersion
}) {
  const structural = validateImportJson(doc, units.length);
  structural._articlesForOrder = doc.articles;

  const typeCounts = countJsonTypes(doc.articles);
  const samples = pickBatchSamples(units, doc.articles, lawKey, structureReport);
  const passEval = evaluateLawPass({
    ambiguities,
    structural,
    samples,
    unknownSectionHeaders: structureReport?.unknownSectionHeaders,
    structureReport
  });

  let suspiciouslyShort = 0;
  for (const a of doc.articles) {
    if (
      a.unitType !== 'tabsereh' &&
      a.content &&
      a.content.length < SHORT_CONTENT_THRESHOLD
    ) {
      suspiciouslyShort += 1;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    lawKey,
    parserVersion,
    result: passEval.pass ? 'PASS' : 'FAIL',
    totals: {
      units: units.length,
      articles: doc.articles.length,
      ...typeCounts
    },
    validation: {
      duplicateCount: structural.duplicateCount,
      emptyContent: structural.emptyContent,
      htmlRemnants: structural.htmlRemnants,
      uiPollution: structural.uiPollution,
      orderingErrorCount: passEval.orderingErrorCount,
      orderingErrors: passEval.orderingErrors.slice(0, 20),
      structuralErrors: structural.errors,
      parseAmbiguityCount: ambiguities.length,
      parseAmbiguities: ambiguities.slice(0, 50),
      unknownSectionHeaders: (structureReport?.unknownSectionHeaders || []).slice(0, 30),
      unknownSectionHeaderCount: passEval.unknownHeaderCount,
      suspiciouslyShortArticles: suspiciouslyShort
    },
    structure: structureReport
      ? {
          bookMarkers: structureReport.bookMarkers,
          numbering: structureReport.numbering,
          prefixApplied: structureReport.prefixApplied,
          prefixMode: structureReport.prefixMode,
          prefixNotes: structureReport.prefixNotes
        }
      : null,
    samples,
    passBreakdown: passEval
  };
}

function validationReportToMd(report, title) {
  const lines = [
    `# ${title}`,
    '',
    `Law key: \`${report.lawKey}\``,
    `Result: **${report.result}**`,
    '',
    '## Totals',
    '',
    `- units: ${report.totals.units}`,
    `- normal: ${report.totals.normal}`,
    `- eslahi: ${report.totals.eslahi}`,
    `- mokarrar: ${report.totals.mokarrar}`,
    `- elhaqi: ${report.totals.elhaqi}`,
    `- tabsereh: ${report.totals.tabsereh}`,
    '',
    '## Validation',
    '',
    `- duplicates: ${report.validation.duplicateCount}`,
    `- empty content: ${report.validation.emptyContent}`,
    `- HTML remnants: ${report.validation.htmlRemnants}`,
    `- UI pollution: ${report.validation.uiPollution}`,
    `- parse ambiguities: ${report.validation.parseAmbiguityCount}`,
    `- ordering errors: ${report.validation.orderingErrorCount}`,
    `- unknown section headers: ${report.validation.unknownSectionHeaderCount}`,
    `- suspiciously short articles: ${report.validation.suspiciouslyShortArticles}`,
    ''
  ];

  if (report.structure) {
    lines.push('## Structure / IPC', '');
    lines.push(`- prefix applied: ${report.structure.prefixApplied}`);
    lines.push(`- prefix mode: ${report.structure.prefixMode || 'none'}`);
    if (report.structure.bookMarkers?.length) {
      lines.push(`- book markers: ${report.structure.bookMarkers.length}`);
      for (const b of report.structure.bookMarkers.slice(0, 8)) {
        lines.push(`  - book ${b.bookIndex} @ line ${b.lineIndex}`);
      }
    }
    if (report.structure.prefixNotes?.length) {
      lines.push('', 'Notes:');
      for (const n of report.structure.prefixNotes) lines.push(`- ${n}`);
    }
    lines.push('');
  }

  if (report.validation.parseAmbiguities?.length) {
    lines.push('## Parse ambiguities (sample)', '');
    for (const a of report.validation.parseAmbiguities.slice(0, 15)) {
      lines.push(`- ${a}`);
    }
    lines.push('');
  }

  lines.push('## Samples', '');
  for (const s of report.samples) {
    lines.push(
      `- **${s.name}** (\`${s.sortKey || 'n/a'}\`): ${s.pass ? 'PASS' : 'FAIL'}${s.reasons?.length ? ` — ${s.reasons.join('; ')}` : ''}`
    );
  }
  return lines.join('\n');
}

module.exports = {
  buildLawValidationReport,
  validationReportToMd,
  compareSortKeysExtended,
  pickBatchSamples
};
