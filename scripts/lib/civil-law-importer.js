/**
 * Civil law JSON → laws / law_articles import planner (dry-run + commit).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  SCHEMA_VERSION,
  validateImportJson,
  parseSortKey
} = require('./qavanin-civil-import');

const EXPECTED_META = Object.freeze({
  lawKey: 'civil-code',
  title: 'قانون مدنی',
  category: 'civil',
  approvalDate: '1314-08-08',
  source: 'qavanin.ir'
});

const ALLOWED_UNIT_TYPES = new Set([
  'normal',
  'eslahi',
  'mokarrar',
  'elhaqi',
  'tabsereh'
]);

function defaultJsonPath() {
  return path.join(
    os.tmpdir(),
    'dadbane-qavanin-prototype',
    'civil-code-import-dry-run.json'
  );
}

function parseCliArgs(argv) {
  const out = {
    file: defaultJsonPath(),
    commit: false,
    confirm: false,
    dryRunFlag: false
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--file' && argv[i + 1]) {
      out.file = path.resolve(argv[++i]);
    } else if (a === '--dry-run') {
      out.dryRunFlag = true;
    } else if (a === '--commit') {
      out.commit = true;
    } else if (a === '--confirm') {
      out.confirm = true;
    } else if (a === '--help' || a === '-h') {
      out.help = true;
    }
  }
  out.willWrite = out.commit && out.confirm;
  out.mode = out.willWrite ? 'commit' : 'dry-run';
  return out;
}

function loadJson(filePath) {
  if (!fs.existsSync(filePath)) {
    return { doc: null, errors: [`File not found: ${filePath}`] };
  }
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return { doc: null, errors: [`Cannot read file: ${err.message}`] };
  }
  try {
    const doc = JSON.parse(raw);
    return { doc, errors: [] };
  } catch (err) {
    return { doc: null, errors: [`Invalid JSON: ${err.message}`] };
  }
}

function validateMeta(doc) {
  const errors = [];
  if (!doc || typeof doc !== 'object') {
    errors.push('Document missing or not an object');
    return errors;
  }
  if (doc.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${SCHEMA_VERSION}, got ${doc.schemaVersion}`);
  }
  const meta = doc.importMeta;
  if (!meta || typeof meta !== 'object') {
    errors.push('importMeta missing');
    return errors;
  }
  if (meta.lawKey !== EXPECTED_META.lawKey) {
    errors.push(`lawKey must be ${EXPECTED_META.lawKey}, got ${meta.lawKey}`);
  }
  if (meta.title !== EXPECTED_META.title) {
    errors.push(`title must be "${EXPECTED_META.title}", got ${meta.title}`);
  }
  if (meta.category !== EXPECTED_META.category) {
    errors.push(`category must be ${EXPECTED_META.category}, got ${meta.category}`);
  }
  if (meta.approvalDate !== EXPECTED_META.approvalDate) {
    errors.push(
      `approvalDate must be ${EXPECTED_META.approvalDate}, got ${meta.approvalDate}`
    );
  }
  if (meta.source !== EXPECTED_META.source) {
    errors.push(`source must be ${EXPECTED_META.source}, got ${meta.source}`);
  }
  if (!Array.isArray(doc.articles) || doc.articles.length === 0) {
    errors.push('articles must be a non-empty array');
  }
  return errors;
}

function validateArticles(doc) {
  const errors = [];
  const articles = doc.articles || [];
  const structural = validateImportJson(doc, articles.length);

  errors.push(...structural.errors);
  if (structural.duplicateCount > 0) {
    errors.push(`duplicate articleNumber/sortKey in JSON: ${structural.duplicateCount}`);
  }
  if (structural.emptyContent > 0) {
    errors.push(`empty content: ${structural.emptyContent}`);
  }
  if (structural.htmlRemnants > 0) {
    errors.push(`HTML remnants in content: ${structural.htmlRemnants}`);
  }
  if (structural.uiPollution > 0) {
    errors.push(`UI pollution in content: ${structural.uiPollution}`);
  }
  if (structural.secretHits > 0) {
    errors.push(`suspicious secret-like patterns: ${structural.secretHits}`);
  }
  if (structural.orderingErrorCount > 0) {
    errors.push(...structural.orderingErrors);
  }

  for (let i = 0; i < articles.length; i += 1) {
    const a = articles[i];
    if (!a.articleNumber || !parseSortKey(a.articleNumber)) {
      errors.push(`invalid articleNumber at index ${i}: ${a.articleNumber}`);
    }
    if (a.unitType && !ALLOWED_UNIT_TYPES.has(a.unitType)) {
      errors.push(`invalid unitType at index ${i}: ${a.unitType}`);
    }
    if (a.source && a.source !== EXPECTED_META.source) {
      errors.push(`article source must be qavanin.ir at index ${i}`);
    }
  }

  return { errors, structural };
}

function validateDocument(doc) {
  const metaErrors = validateMeta(doc);
  if (metaErrors.length) return { ok: false, errors: metaErrors, structural: null };
  const { errors, structural } = validateArticles(doc);
  return { ok: errors.length === 0, errors, structural };
}

async function countTables(db) {
  const laws = Number((await db('laws').count({ c: '*' }).first()).c);
  const articles = Number((await db('law_articles').count({ c: '*' }).first()).c);
  return { laws, articles };
}

async function findExistingLaw(db) {
  return db('laws')
    .where({
      category: EXPECTED_META.category,
      title: EXPECTED_META.title
    })
    .first();
}

async function buildImportPlan(db, doc) {
  const law = await findExistingLaw(db);
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

async function executeImport(db, doc, plan) {
  return db.transaction(async (trx) => {
    let lawId = plan.lawId;
    if (!lawId) {
      const inserted = await trx('laws').insert({
        title: EXPECTED_META.title,
        category: EXPECTED_META.category,
        approval_date: EXPECTED_META.approvalDate,
        source: EXPECTED_META.source,
        updated_at: trx.fn.now()
      });
      lawId = Array.isArray(inserted) ? inserted[0] : inserted;
    }

    for (const a of plan.toInsert) {
      await trx('law_articles').insert({
        law_id: lawId,
        article_number: a.articleNumber,
        title: articleTitleForDb(a),
        content: a.content,
        source: a.source || EXPECTED_META.source,
        updated_at: trx.fn.now()
      });
    }

    return { lawId, insertedArticles: plan.toInsert.length, createdLaw: plan.lawWouldCreate };
  });
}

module.exports = {
  EXPECTED_META,
  defaultJsonPath,
  parseCliArgs,
  loadJson,
  validateDocument,
  countTables,
  findExistingLaw,
  buildImportPlan,
  executeImport
};
