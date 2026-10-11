/**
 * Generic qavanin JSON → laws / law_articles (DEV import). Civil uses civil-law-importer wrapper.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  SCHEMA_VERSION,
  validateImportJson,
  parseSortKey
} = require('./qavanin-civil-import');

const ALLOWED_UNIT_TYPES = new Set([
  'normal',
  'eslahi',
  'mokarrar',
  'elhaqi',
  'tabsereh'
]);

const SOURCE_QAVANIN = 'qavanin.ir';
const LAW_KEY_DESC_PREFIX = 'dadbane:lawKey=';

function lawKeyDescription(lawKey) {
  return `${LAW_KEY_DESC_PREFIX}${lawKey}`;
}

function metaFromDocument(doc) {
  const m = doc.importMeta || {};
  return {
    lawKey: m.lawKey,
    title: m.title,
    category: m.category,
    approvalDate: m.approvalDate || null,
    source: m.source || SOURCE_QAVANIN
  };
}

function isValidArticleNumber(key) {
  if (!key || String(key).length > 64) return false;
  if (String(key) !== String(key).trim()) return false;
  if (parseSortKey(key)) return true;
  if (/^00000-n\d+$/.test(String(key))) return true;
  if (/^(?:B\d{2}(?:-F\d{2})?-|K\d+-)\d{5}(?:-[rneo]\d+)?(?:-o\d+)?$/.test(String(key))) {
    return true;
  }
  return /^\d{5}(?:-[rneo]\d+)?(?:-o\d+)?$/.test(String(key));
}

function loadJson(filePath) {
  if (!fs.existsSync(filePath)) {
    return { doc: null, errors: [`File not found: ${filePath}`] };
  }
  try {
    const doc = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return { doc, errors: [] };
  } catch (err) {
    return { doc: null, errors: [`Invalid JSON: ${err.message}`] };
  }
}

function validateDocument(doc, options = {}) {
  const errors = [];
  if (!doc || typeof doc !== 'object') {
    return { ok: false, errors: ['Document missing or not an object'], structural: null };
  }
  if (doc.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${SCHEMA_VERSION}, got ${doc.schemaVersion}`);
  }
  const meta = metaFromDocument(doc);
  if (!meta.lawKey) errors.push('importMeta.lawKey missing');
  if (!meta.title) errors.push('importMeta.title missing');
  if (!meta.category) errors.push('importMeta.category missing');
  if (options.expectedLawKey && meta.lawKey !== options.expectedLawKey) {
    errors.push(`lawKey expected ${options.expectedLawKey}, got ${meta.lawKey}`);
  }
  if (meta.source !== SOURCE_QAVANIN) {
    errors.push(`source must be ${SOURCE_QAVANIN}, got ${meta.source}`);
  }
  if (!Array.isArray(doc.articles) || doc.articles.length === 0) {
    errors.push('articles must be a non-empty array');
  }
  if (errors.length) return { ok: false, errors, structural: null };

  const structural = validateImportJson(doc, doc.articles.length);
  errors.push(...structural.errors);
  if (structural.duplicateCount > 0) {
    errors.push(`duplicate articleNumber/sortKey in JSON: ${structural.duplicateCount}`);
  }
  if (structural.emptyContent > 0) {
    errors.push(`empty content: ${structural.emptyContent}`);
  }
  if (structural.orderingErrorCount > 0) {
    errors.push(...structural.orderingErrors);
  }

  for (let i = 0; i < doc.articles.length; i += 1) {
    const a = doc.articles[i];
    if (a.articleNumber !== a.sortKey) {
      errors.push(`articleNumber !== sortKey at index ${i}`);
    }
    if (!isValidArticleNumber(a.articleNumber)) {
      errors.push(`invalid articleNumber at index ${i}: ${a.articleNumber}`);
    }
    if (a.unitType && !ALLOWED_UNIT_TYPES.has(a.unitType)) {
      errors.push(`invalid unitType at index ${i}: ${a.unitType}`);
    }
    if (!a.content || String(a.content).trim().length === 0) {
      errors.push(`empty content at index ${i}`);
    }
  }

  return { ok: errors.length === 0, errors, structural };
}

async function countTables(db) {
  const laws = Number((await db('laws').count({ c: '*' }).first()).c);
  const articles = Number((await db('law_articles').count({ c: '*' }).first()).c);
  return { laws, articles };
}

async function findLawByKey(db, lawKey) {
  return db('laws').where({ description: lawKeyDescription(lawKey) }).first();
}

async function buildImportPlan(db, doc) {
  const meta = metaFromDocument(doc);
  const law = await findLawByKey(db, meta.lawKey);
  const existingSet = new Set();
  if (law) {
    const rows = await db('law_articles')
      .where({ law_id: law.id })
      .select('article_number');
    for (const r of rows) existingSet.add(r.article_number);
  }

  const toInsert = [];
  const alreadyInDb = [];
  for (const a of doc.articles) {
    if (existingSet.has(a.articleNumber)) alreadyInDb.push(a.articleNumber);
    else toInsert.push(a);
  }

  return {
    meta,
    law,
    lawId: law ? law.id : null,
    lawWouldCreate: !law,
    articlesTotal: doc.articles.length,
    existingInDbCount: alreadyInDb.length,
    newCount: toInsert.length,
    alreadyInDb,
    toInsert
  };
}

function articleTitleForDb(article) {
  if (article.title && String(article.title).trim().length > 0) {
    return String(article.title).trim();
  }
  return null;
}

async function executeLawImport(trx, doc, plan) {
  const meta = plan.meta || metaFromDocument(doc);
  let lawId = plan.lawId;
  let createdLaw = false;
  if (!lawId) {
    const inserted = await trx('laws').insert({
      title: meta.title,
      category: meta.category,
      approval_date: meta.approvalDate,
      source: meta.source,
      description: lawKeyDescription(meta.lawKey),
      updated_at: trx.fn.now()
    });
    lawId = Array.isArray(inserted) ? inserted[0] : inserted;
    createdLaw = true;
  }

  for (const a of plan.toInsert) {
    await trx('law_articles').insert({
      law_id: lawId,
      article_number: a.articleNumber,
      title: articleTitleForDb(a),
      content: a.content,
      source: a.source || meta.source,
      updated_at: trx.fn.now()
    });
  }

  return {
    lawId,
    lawKey: meta.lawKey,
    insertedArticles: plan.toInsert.length,
    createdLaw,
    articlesTotal: plan.articlesTotal
  };
}

function defaultBatchDir() {
  return path.join(os.tmpdir(), 'dadbane-qavanin-batch');
}

function jsonPathForLawKey(batchDir, lawKey) {
  return path.join(batchDir, `${lawKey}.json`);
}

module.exports = {
  SOURCE_QAVANIN,
  LAW_KEY_DESC_PREFIX,
  lawKeyDescription,
  metaFromDocument,
  isValidArticleNumber,
  loadJson,
  validateDocument,
  countTables,
  findLawByKey,
  buildImportPlan,
  executeLawImport,
  defaultBatchDir,
  jsonPathForLawKey,
  ALLOWED_UNIT_TYPES
};
