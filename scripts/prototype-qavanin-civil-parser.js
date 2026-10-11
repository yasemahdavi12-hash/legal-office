/**
 * Prototype: fetch qavanin.ir civil code BorderText + parse + validate.
 * Raw output lives outside the git repo (temp). No DB import.
 *
 * Usage: node scripts/prototype-qavanin-civil-parser.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright');
const {
  parseBorderText,
  countByType,
  contentHasNestedUnitHeader,
  findUnit
} = require('./lib/qavanin-border-parser');

const SOURCE_URL =
  'https://www.qavanin.ir/Law/TreeText/?IDS=12021850837713548188';

const OUT_DIR = path.join(os.tmpdir(), 'dadbane-qavanin-prototype');

function ensureOutDir() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

async function fetchBorderText(url) {
  // ArvanCloud challenge often blocks headless Chromium; real window is required.
  const headless = process.env.PW_HEADLESS === '1';
  const browser = await chromium.launch({
    headless,
    args: ['--disable-blink-features=AutomationControlled']
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(180_000);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'fa-IR,fa;q=0.9,en;q=0.8' });

  await page.goto(url, { waitUntil: 'networkidle', timeout: 180_000 });
  await page.waitForSelector('div.BorderText.treeTextView', { timeout: 120_000 });
  await page.waitForFunction(
    () => {
      const el = document.querySelector('div.BorderText.treeTextView');
      return el && el.innerText && el.innerText.length > 10_000;
    },
    { timeout: 60_000 }
  );
  await page.waitForTimeout(3_000);

  const html = await page.locator('div.BorderText.treeTextView').innerHTML();
  const text = await page.locator('div.BorderText.treeTextView').innerText();

  await browser.close();

  if (!html || html.length < 500) {
    throw new Error('BorderText HTML too short — fetch may have failed');
  }
  return { html, text, fetchedAt: new Date().toISOString() };
}

function validateSample(name, unit, extra = {}) {
  const reasons = [];
  if (!unit) {
    return { name, pass: false, reasons: ['unit not found'] };
  }
  if (!unit.content || unit.content.length < 2) {
    reasons.push('content empty or too short');
  }
  if (contentHasNestedUnitHeader(unit.content)) {
    reasons.push('content contains nested ماده/تبصره header line');
  }
  if (extra.expectedUnitType && unit.unitType !== extra.expectedUnitType) {
    reasons.push(`unitType expected ${extra.expectedUnitType}, got ${unit.unitType}`);
  }
  if (extra.expectedArticleNumber && String(unit.articleNumber) !== String(extra.expectedArticleNumber)) {
    reasons.push(`articleNumber expected ${extra.expectedArticleNumber}, got ${unit.articleNumber}`);
  }
  if (extra.expectedSortKey && unit.sortKey !== extra.expectedSortKey) {
    reasons.push(`sortKey expected ${extra.expectedSortKey}, got ${unit.sortKey}`);
  }
  if (extra.minContentLength && unit.content.length < extra.minContentLength) {
    reasons.push(`content length ${unit.content.length} < ${extra.minContentLength}`);
  }
  return {
    name,
    pass: reasons.length === 0,
    reasons,
    unit: {
      displayNumber: unit.displayNumber,
      unitType: unit.unitType,
      sortKey: unit.sortKey,
      contentLength: unit.content.length,
      lineIndex: unit.lineIndex
    }
  };
}

function seededPick(arr, count, seed) {
  const copy = [...arr];
  let s = seed;
  for (let i = copy.length - 1; i > 0; i -= 1) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count);
}

async function main() {
  ensureOutDir();

  console.log('Fetching BorderText from qavanin.ir (Playwright)...');
  console.log('Output directory:', OUT_DIR);

  const { html, text, fetchedAt } = await fetchBorderText(SOURCE_URL);

  const htmlPath = path.join(OUT_DIR, 'border-text.html');
  const textPath = path.join(OUT_DIR, 'border-text.txt');
  fs.writeFileSync(htmlPath, html, 'utf8');
  fs.writeFileSync(textPath, text, 'utf8');
  console.log('Saved raw HTML:', htmlPath);
  console.log('Saved raw text:', textPath);

  const { units, ambiguities: parseAmbiguities } = parseBorderText(html);
  const counts = countByType(units);

  const article10 = findUnit(
    units,
    (u) => u.unitType !== 'tabsera' && u.articleNumber === '10' && u.unitType === 'ordinary'
  );
  const article1 = findUnit(
    units,
    (u) => u.articleNumber === '1' && (u.unitType === 'amended' || u.unitType === 'ordinary')
  );
  const tabseraAfter1 = findUnit(
    units,
    (u) => u.unitType === 'tabsera' && u.articleNumber === '1' && u.sortKey === '00001-n1'
  );
  const m218m = findUnit(
    units,
    (u) =>
      u.articleNumber === '218' &&
      (u.unitType === 'mokarrar' || u.unitType === 'elhaqi') &&
      /^00218-r\d+$/.test(u.sortKey)
  );

  const coreValidations = [
    validateSample('ماده 10 (معمولی)', article10, {
      expectedArticleNumber: '10',
      expectedUnitType: 'ordinary',
      expectedSortKey: '00010',
      minContentLength: 20
    }),
    validateSample('ماده 1', article1, {
      expectedArticleNumber: '1',
      expectedUnitType: 'amended',
      expectedSortKey: '00001',
      minContentLength: 20
    }),
    validateSample('تبصره ماده 1 (n1)', tabseraAfter1, {
      expectedArticleNumber: '1',
      expectedUnitType: 'tabsera',
      expectedSortKey: '00001-n1',
      minContentLength: 10
    }),
    validateSample('ماده 218 مكرر', m218m, {
      expectedArticleNumber: '218',
      expectedUnitType: 'elhaqi',
      expectedSortKey: '00218-r1',
      minContentLength: 5
    })
  ];

  const madddeUnits = units.filter((u) => u.unitType !== 'tabsera');
  const excludeBases = new Set(['1', '10', '218']);
  const pool = madddeUnits.filter((u) => !excludeBases.has(String(u.articleNumber)));
  const randomPick = seededPick(pool, 10, 42);
  const randomValidations = randomPick.map((u, idx) =>
    validateSample(`random #${idx + 1} art ${u.displayNumber} (${u.unitType})`, u, {
      expectedArticleNumber: u.articleNumber,
      expectedSortKey: u.sortKey,
      minContentLength: 5
    })
  );

  const report = {
    sourceUrl: SOURCE_URL,
    fetchedAt,
    outDir: OUT_DIR,
    totals: {
      unitsParsed: units.length,
      madddeOccurrences: counts.madddeOccurrences,
      ordinary: counts.ordinary,
      amended: counts.amended,
      mokarrar: counts.mokarrar,
      elhaqi: counts.elhaqi,
      tabsera: counts.tabsera,
      note:
        'madddeOccurrences = parsed ماده/مكرر/الحاقی units, not an official statute count'
    },
    parseAmbiguities: parseAmbiguities.slice(0, 50),
    parseAmbiguityCount: parseAmbiguities.length,
    coreValidations,
    randomValidations,
    corePass: coreValidations.every((v) => v.pass),
    randomPass: randomValidations.every((v) => v.pass)
  };

  const reportJson = path.join(OUT_DIR, 'validation-report.json');
  const reportMd = path.join(OUT_DIR, 'validation-report.md');
  fs.writeFileSync(reportJson, JSON.stringify(report, null, 2), 'utf8');

  const mdLines = [
    '# Qavanin civil code — prototype validation',
    '',
    `Fetched: ${fetchedAt}`,
    `Source: ${SOURCE_URL}`,
    '',
    '## Totals',
    '',
    `- unitsParsed: ${report.totals.unitsParsed}`,
    `- madddeOccurrences (شناسایی‌شده، نه ادعای رسمی): ${report.totals.madddeOccurrences}`,
    `- ordinary: ${report.totals.ordinary}`,
    `- amended: ${report.totals.amended}`,
    `- mokarrar: ${report.totals.mokarrar}`,
    `- elhaqi: ${report.totals.elhaqi}`,
    `- tabsera: ${report.totals.tabsera}`,
    '',
    '## Core samples',
    ''
  ];
  for (const v of coreValidations) {
    mdLines.push(`- **${v.name}**: ${v.pass ? 'PASS' : 'FAIL'}${v.reasons.length ? ` — ${v.reasons.join('; ')}` : ''}`);
  }
  mdLines.push('', '## Random 10', '');
  for (const v of randomValidations) {
    mdLines.push(`- **${v.name}**: ${v.pass ? 'PASS' : 'FAIL'}${v.reasons.length ? ` — ${v.reasons.join('; ')}` : ''}`);
  }
  if (parseAmbiguities.length) {
    mdLines.push('', '## Parse ambiguities (first 20)', '');
    parseAmbiguities.slice(0, 20).forEach((a) => mdLines.push(`- ${a}`));
  }
  fs.writeFileSync(reportMd, mdLines.join('\n'), 'utf8');

  console.log('\n--- Validation summary ---');
  console.log('Units parsed:', report.totals.unitsParsed);
  console.log('Maddde occurrences (identified):', report.totals.madddeOccurrences);
  console.log('ordinary / amended / mokarrar / elhaqi / tabsera:', [
    counts.ordinary,
    counts.amended,
    counts.mokarrar,
    counts.elhaqi,
    counts.tabsera
  ].join(' / '));
  console.log('Parse ambiguities:', parseAmbiguities.length);

  for (const v of coreValidations) {
    console.log(`${v.pass ? 'PASS' : 'FAIL'}  ${v.name}${v.reasons.length ? ' — ' + v.reasons.join('; ') : ''}`);
  }
  console.log('--- Random 10 ---');
  for (const v of randomValidations) {
    console.log(`${v.pass ? 'PASS' : 'FAIL'}  ${v.name}${v.reasons.length ? ' — ' + v.reasons.join('; ') : ''}`);
  }

  console.log('\nReports:', reportJson, reportMd);

  const ready =
    report.corePass &&
    report.randomPass &&
    parseAmbiguities.length < 30 &&
    report.totals.madddeOccurrences > 100;

  console.log('\nParser ready for next phase?', ready ? 'PARTIAL (see report)' : 'NO');
  process.exit(report.corePass && report.randomPass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
