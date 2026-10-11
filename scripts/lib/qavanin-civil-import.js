/**
 * Map qavanin BorderText parser units → import JSON (dry-run). No DB access.
 */

const PARSER_VERSION = '1.0.0';
const SCHEMA_VERSION = 1;

const UNIT_TYPE_TO_JSON = Object.freeze({
  ordinary: 'normal',
  amended: 'eslahi',
  mokarrar: 'mokarrar',
  elhaqi: 'elhaqi',
  tabsera: 'tabsereh'
});

const SORT_KEY_RE =
  /^(?:(?:B\d{2}(?:-F\d{2})?-|K\d+-))?(\d{5})(?:-([rneo])(\d+))?$/;

const HTML_TAG_RE = /<\/?[a-zA-Z][^>]*>/;
const SECRET_PATTERNS = [
  /(?:api[_-]?key|secret|password|authorization)\s*[:=]/i,
  /(?:session|cookie|set-cookie)\s*[:=]/i,
  /\bBearer\s+[A-Za-z0-9._-]{20,}/
];

const UI_POLLUTION_RE =
  /(?:درختواره|جستجو\s*در\s*متن|Transferring|ArvanCloud|navbar|footer-menu|cookie-banner)/;

function structuralPrefix(key) {
  const s = String(key);
  const bm = s.match(/^(B\d{2}(?:-F\d{2})?-)/);
  if (bm) return bm[1];
  const km = s.match(/^(K\d+-)/);
  if (km) return km[1];
  return '';
}

function compareSortKeys(a, b) {
  const pa = parseSortKey(a);
  const pb = parseSortKey(b);
  if (!pa || !pb) return String(a).localeCompare(String(b), 'en');
  const preA = structuralPrefix(a);
  const preB = structuralPrefix(b);
  if (preA !== preB) return preA.localeCompare(preB, 'en');
  if (pa.base !== pb.base) return pa.base - pb.base;
  const kindOrder = { m: 0, e: 1, o: 2, n: 3, r: 4 };
  if (pa.kind !== pb.kind) return kindOrder[pa.kind] - kindOrder[pb.kind];
  return pa.suffix - pb.suffix;
}

function parseSortKey(key) {
  const stripped = String(key).replace(/^(?:B\d{2}(?:-F\d{2})?-|K\d+-)/, '');
  const m = stripped.match(/^(\d{5})(?:-([rneo])(\d+))?$/);
  if (!m) return null;
  return {
    base: Number(m[1]),
    kind: m[2] || 'm',
    suffix: m[3] ? Number(m[3]) : 0
  };
}

function parentSortKeyFromTabsera(sortKey) {
  const stripped = String(sortKey).replace(/^(?:B\d{2}(?:-F\d{2})?-|K\d+-)/, '');
  const m = stripped.match(/^(\d{5})-n\d+$/);
  return m ? m[1] : null;
}

/**
 * Canonical law_articles.article_number = sortKey (5-digit base + optional -n/-r suffix).
 */
function unitToArticleJson(unit) {
  const unitType = UNIT_TYPE_TO_JSON[unit.unitType] || unit.unitType;
  return {
    articleNumber: unit.sortKey,
    displayNumber: unit.displayNumber,
    unitType,
    sortKey: unit.sortKey,
    content: unit.content,
    amendmentDate: unit.amendmentDate || null,
    additionDate: unit.additionDate || null,
    source: 'qavanin.ir',
    _meta: {
      baseNumber: unit.baseNumber || unit.articleNumber,
      lineIndex: unit.lineIndex
    }
  };
}

function stripMetaForExport(article) {
  const { _meta, ...rest } = article;
  return rest;
}

function buildImportDocument({
  units,
  sourceUrl,
  fetchedAt,
  titleOnSite,
  lawKey,
  title,
  category,
  approvalDate,
  articleNumberContract
}) {
  const ordered = [...units].sort((a, b) => compareSortKeys(a.sortKey, b.sortKey));
  const articlesRaw = ordered.map(unitToArticleJson);
  const articles = articlesRaw.map(stripMetaForExport);

  return {
    schemaVersion: SCHEMA_VERSION,
    importMeta: {
      lawKey: lawKey || 'civil-code',
      title: title || 'قانون مدنی',
      titleOnSite: titleOnSite || null,
      category: category || 'civil',
      approvalDate: approvalDate || '1314-08-08',
      source: 'qavanin.ir',
      sourceUrl,
      fetchedAt,
      parserVersion: PARSER_VERSION,
      status: 'dry-run',
      articleNumberContract:
        articleNumberContract ||
        'law_articles.article_number = sortKey; 5-digit zero-padded base; -n# tabsera; -r# mokarrar/elhaqi'
    },
    articles
  };
}

function countJsonTypes(articles) {
  const c = { normal: 0, eslahi: 0, mokarrar: 0, elhaqi: 0, tabsereh: 0 };
  for (const a of articles) {
    if (c[a.unitType] !== undefined) c[a.unitType] += 1;
  }
  return c;
}

function validateImportJson(doc, parserUnitCount) {
  const errors = [];
  const articles = doc.articles || [];

  if (articles.length !== parserUnitCount) {
    errors.push(
      `count mismatch: JSON articles=${articles.length}, parser units=${parserUnitCount}`
    );
  }

  const seenArticleNumber = new Map();
  const seenSortKey = new Map();
  let duplicateCount = 0;
  let emptyContent = 0;
  let htmlRemnants = 0;
  let uiPollution = 0;
  let secretHits = 0;
  const orderingErrors = [];

  for (const a of articles) {
    if (!a.content || String(a.content).trim().length === 0) emptyContent += 1;
    if (HTML_TAG_RE.test(a.content || '')) htmlRemnants += 1;
    if (UI_POLLUTION_RE.test(a.content || '')) uiPollution += 1;
    for (const re of SECRET_PATTERNS) {
      if (re.test(a.content || '') || re.test(JSON.stringify(a))) secretHits += 1;
    }

    if (seenArticleNumber.has(a.articleNumber)) duplicateCount += 1;
    else seenArticleNumber.set(a.articleNumber, true);

    if (seenSortKey.has(a.sortKey)) duplicateCount += 1;
    else seenSortKey.set(a.sortKey, true);

    if (a.articleNumber !== a.sortKey) {
      errors.push(`articleNumber !== sortKey for ${a.sortKey}`);
    }
  }

  for (let i = 1; i < articles.length; i += 1) {
    if (compareSortKeys(articles[i - 1].sortKey, articles[i].sortKey) > 0) {
      orderingErrors.push(
        `sequential order at index ${i}: ${articles[i - 1].sortKey} before ${articles[i].sortKey}`
      );
      break;
    }
  }

  return {
    errors,
    duplicateCount,
    emptyContent,
    htmlRemnants,
    uiPollution,
    secretHits,
    orderingErrors,
    orderingErrorCount: orderingErrors.length
  };
}

function findArticle(articles, sortKey) {
  return articles.find((a) => a.sortKey === sortKey) || null;
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

function validateCoreSamples(articles, units) {
  const samples = [];

  function check(name, sortKey, unitPredicate, extra = {}) {
    const art = findArticle(articles, sortKey);
    const unit = units.find(unitPredicate);
    const reasons = [];
    if (!art) reasons.push('missing in JSON');
    if (!unit) reasons.push('missing in parser units');
    if (art && unit) {
      if (art.content !== unit.content) reasons.push('content differs from parser unit');
      if (art.sortKey !== unit.sortKey) reasons.push('sortKey mismatch');
      if (extra.unitType && art.unitType !== extra.unitType) {
        reasons.push(`unitType expected ${extra.unitType}, got ${art.unitType}`);
      }
    }
    samples.push({ name, pass: reasons.length === 0, reasons, sortKey });
  }

  check('ماده 10 (normal)', '00010', (u) => u.sortKey === '00010' && u.unitType === 'ordinary', {
    unitType: 'normal'
  });
  check('ماده 1 (eslahi)', '00001', (u) => u.sortKey === '00001' && u.unitType === 'amended', {
    unitType: 'eslahi'
  });
  check('تبصره ماده 1', '00001-n1', (u) => u.sortKey === '00001-n1' && u.unitType === 'tabsera', {
    unitType: 'tabsereh'
  });
  check('ماده 218 (eslahi)', '00218', (u) => u.sortKey === '00218' && u.unitType === 'amended', {
    unitType: 'eslahi'
  });
  check('ماده 218 مكرر (elhaqi)', '00218-r1', (u) => u.sortKey === '00218-r1' && u.unitType === 'elhaqi', {
    unitType: 'elhaqi'
  });

  return samples;
}

function validateRandomSamples(articles, units, seed = 42) {
  const maddde = units.filter((u) => u.unitType !== 'tabsera');
  const exclude = new Set(['00001', '00010', '00218', '00218-r1']);
  const pool = maddde.filter((u) => !exclude.has(u.sortKey));
  const pick = seededPick(pool, 10, seed);
  return pick.map((u, idx) => {
    const art = findArticle(articles, u.sortKey);
    const reasons = [];
    if (!art) reasons.push('missing in JSON');
    else if (art.content !== u.content) reasons.push('content differs from parser');
    return {
      name: `random #${idx + 1} ${u.sortKey} (${u.unitType})`,
      pass: reasons.length === 0,
      reasons,
      sortKey: u.sortKey
    };
  });
}

module.exports = {
  PARSER_VERSION,
  SCHEMA_VERSION,
  compareSortKeys,
  parseSortKey,
  parentSortKeyFromTabsera,
  buildImportDocument,
  countJsonTypes,
  validateImportJson,
  validateCoreSamples,
  validateRandomSamples,
  UNIT_TYPE_TO_JSON
};
