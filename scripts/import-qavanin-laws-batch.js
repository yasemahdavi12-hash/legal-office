/**
 * Batch DEV import for 12 validated qavanin laws (SQLite). Civil code excluded.
 *
 *   node scripts/import-qavanin-laws-batch.js
 *   node scripts/import-qavanin-laws-batch.js --commit --confirm
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const db = require('../src/db/connection');
const {
  defaultBatchDir,
  jsonPathForLawKey,
  loadJson,
  validateDocument,
  countTables,
  buildImportPlan,
  executeLawImport,
  findLawByKey,
  metaFromDocument
} = require('./lib/qavanin-law-importer');

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

const CIVIL_CODE_TITLE = 'قانون مدنی';
const CIVIL_CODE_CATEGORY = 'civil';

const SENSITIVE_SAMPLES = Object.freeze({
  'family-protection': ['00001', '00001-n1', '00001-n2'],
  'direct-tax': ['00040', '00040-e1', '00040-r1', '00041', '00041-e1'],
  commerce: ['B01-00001', 'B03-F01-00001'],
  'ipc-book5': ['00498']
});

function parseCliArgs(argv) {
  const out = { batchDir: defaultBatchDir(), commit: false, confirm: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dir' && argv[i + 1]) out.batchDir = path.resolve(argv[++i]);
    else if (a === '--commit') out.commit = true;
    else if (a === '--confirm') out.confirm = true;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  out.willWrite = out.commit && out.confirm;
  return out;
}

async function findCivilLaw(dbConn) {
  return dbConn('laws')
    .where({ title: CIVIL_CODE_TITLE, category: CIVIL_CODE_CATEGORY })
    .first();
}

async function civilSnapshot(dbConn, civilLaw) {
  if (!civilLaw) return null;
  const count = Number(
    (await dbConn('law_articles').where({ law_id: civilLaw.id }).count({ c: '*' }).first()).c
  );
  const samples = await dbConn('law_articles')
    .where({ law_id: civilLaw.id })
    .whereIn('article_number', ['00001', '00010', '00218', '00218-r1'])
    .select('article_number', 'content');
  const byNum = new Map(samples.map((r) => [r.article_number, r.content]));
  return { lawId: civilLaw.id, articleCount: count, samples: byNum };
}

function loadBatchDocs(batchDir) {
  const docs = [];
  const errors = [];
  for (const lawKey of BATCH_LAW_KEYS) {
    const file = jsonPathForLawKey(batchDir, lawKey);
    const { doc, errors: loadErr } = loadJson(file);
    if (loadErr.length) {
      errors.push(`${lawKey}: ${loadErr.join('; ')}`);
      continue;
    }
    const v = validateDocument(doc, { expectedLawKey: lawKey });
    if (!v.ok) {
      errors.push(`${lawKey}: ${v.errors.join('; ')}`);
      continue;
    }
    docs.push({ lawKey, file, doc });
  }
  return { docs, errors };
}

async function postImportValidation(dbConn, docs, civilBefore) {
  const report = {
    pass: true,
    errors: [],
    lawCount: 0,
    perLaw: [],
    duplicatePairs: 0,
    emptyContent: 0,
    sensitiveSamples: {},
    civilRegression: false
  };

  for (const { lawKey, doc } of docs) {
    const meta = metaFromDocument(doc);
    const law = await findLawByKey(dbConn, lawKey);
    const expected = doc.articles.length;
    if (!law) {
      report.pass = false;
      report.errors.push(`missing law row for ${lawKey}`);
      continue;
    }
    const actual = Number(
      (await dbConn('law_articles').where({ law_id: law.id }).count({ c: '*' }).first()).c
    );
    const dupRows = await dbConn('law_articles')
      .where({ law_id: law.id })
      .select('article_number')
      .count('* as c')
      .groupBy('article_number')
      .havingRaw('c > 1');
    const empty = Number(
      (
        await dbConn('law_articles')
          .where({ law_id: law.id })
          .whereRaw("(content IS NULL OR TRIM(content) = '')")
          .count({ c: '*' })
          .first()
      ).c
    );

    if (actual !== expected) {
      report.pass = false;
      report.errors.push(`${lawKey}: article count ${actual} !== JSON ${expected}`);
    }
    if (dupRows.length > 0) {
      report.pass = false;
      report.errors.push(`${lawKey}: duplicate article_number groups ${dupRows.length}`);
    }
    report.duplicatePairs += dupRows.length;
    report.emptyContent += empty;
    if (empty > 0) {
      report.pass = false;
      report.errors.push(`${lawKey}: empty content rows ${empty}`);
    }

    const sens = SENSITIVE_SAMPLES[lawKey];
    if (sens) {
      const rows = await dbConn('law_articles')
        .where({ law_id: law.id })
        .whereIn('article_number', sens)
        .select('article_number', 'content');
      const jsonBy = new Map(doc.articles.map((a) => [a.articleNumber, a.content]));
      const sensReport = {};
      for (const num of sens) {
        const row = rows.find((r) => r.article_number === num);
        const jsonContent = jsonBy.get(num);
        sensReport[num] = {
          found: !!row,
          contentMatch: row ? row.content === jsonContent : false
        };
        if (!row || row.content !== jsonContent) report.pass = false;
      }
      report.sensitiveSamples[lawKey] = sensReport;
    }

    report.perLaw.push({
      lawKey,
      lawId: law.id,
      title: meta.title,
      articlesExpected: expected,
      articlesActual: actual,
      insertedExpected: expected
    });
  }

  report.lawCount = (
    await dbConn('laws').whereIn(
      'description',
      BATCH_LAW_KEYS.map((k) => `dadbane:lawKey=${k}`)
    )
  ).length;

  if (report.lawCount !== BATCH_LAW_KEYS.length) {
    report.pass = false;
    report.errors.push(`batch law rows ${report.lawCount} !== ${BATCH_LAW_KEYS.length}`);
  }

  if (civilBefore) {
    const civil = await findCivilLaw(dbConn);
    const after = await civilSnapshot(dbConn, civil);
    report.civilRegression =
      !!after &&
      after.articleCount === civilBefore.articleCount &&
      after.lawId === civilBefore.lawId;
    for (const [num, content] of civilBefore.samples.entries()) {
      if (after.samples.get(num) !== content) report.civilRegression = false;
    }
    if (!report.civilRegression) {
      report.pass = false;
      report.errors.push('Civil Code regression detected');
    }
  }

  const dupList = await dbConn('law_articles')
    .select('law_id', 'article_number')
    .count('* as c')
    .groupBy('law_id', 'article_number')
    .havingRaw('c > 1');
  if (dupList.length > 0) {
    report.pass = false;
    report.errors.push(`global duplicate (law_id, article_number): ${dupList.length}`);
  }

  return report;
}

async function main() {
  const args = parseCliArgs(process.argv);
  if (args.help) {
    console.log(`Usage:
  node scripts/import-qavanin-laws-batch.js [--dir batch-json-dir]
  node scripts/import-qavanin-laws-batch.js --commit --confirm [--dir ...]`);
    process.exit(0);
  }

  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to run batch import in production.');
    process.exit(1);
  }

  console.log('Mode:', args.willWrite ? 'commit' : 'dry-run');
  console.log('Batch JSON dir:', args.batchDir);

  const { docs, errors: loadErrors } = loadBatchDocs(args.batchDir);
  if (loadErrors.length) {
    console.error('Pre-load validation failed:');
    loadErrors.forEach((e) => console.error(' -', e));
    process.exit(1);
  }
  if (docs.length !== BATCH_LAW_KEYS.length) {
    console.error(`Expected ${BATCH_LAW_KEYS.length} docs, got ${docs.length}`);
    process.exit(1);
  }

  const countsBefore = await countTables(db);
  const civilLaw = await findCivilLaw(db);
  const civilBefore = await civilSnapshot(db, civilLaw);
  console.log('\n--- Before ---');
  console.log('laws:', countsBefore.laws, 'articles:', countsBefore.articles);
  if (civilBefore) {
    console.log('Civil Code law id:', civilBefore.lawId, 'articles:', civilBefore.articleCount);
  }

  console.log('\n--- Expected from JSON ---');
  const plans = [];
  for (const { lawKey, doc, file } of docs) {
    const plan = await buildImportPlan(db, doc);
    plans.push({ lawKey, doc, file, plan });
    console.log(
      `${lawKey}: JSON articles=${plan.articlesTotal}, existing=${plan.existingInDbCount}, new=${plan.newCount}, createLaw=${plan.lawWouldCreate}`
    );
  }

  if (!args.willWrite) {
    console.log('\nFinal result: PASS (dry-run, no DB writes)');
    await db.destroy();
    process.exit(0);
  }

  let results = [];
  try {
    await db.transaction(async (trx) => {
      for (const item of plans) {
        const result = await executeLawImport(trx, item.doc, item.plan);
        results.push(result);
      }
    });
  } catch (err) {
    console.error('Transaction failed (rolled back):', err.message);
    const countsAfter = await countTables(db);
    console.log('After rollback — laws:', countsAfter.laws, 'articles:', countsAfter.articles);
    console.log('Final result: FAIL');
    await db.destroy();
    process.exit(1);
  }

  const countsAfter = await countTables(db);
  const validation = await postImportValidation(db, docs, civilBefore);

  console.log('\n--- Commit summary ---');
  let newLaws = 0;
  let totalInserted = 0;
  for (const r of results) {
    if (r.createdLaw) newLaws += 1;
    totalInserted += r.insertedArticles;
    console.log(
      `${r.lawKey}: lawId=${r.lawId} createdLaw=${r.createdLaw} inserted=${r.insertedArticles} total=${r.articlesTotal}`
    );
  }
  console.log('DB after — laws:', countsAfter.laws, 'articles:', countsAfter.articles);

  console.log('\n--- Post-import validation ---');
  console.log('PASS/FAIL:', validation.pass ? 'PASS' : 'FAIL');
  if (validation.errors.length) validation.errors.forEach((e) => console.log(' -', e));
  console.log('Batch laws in DB:', validation.lawCount);
  console.log('New law rows this run:', newLaws);
  console.log('Articles inserted this run:', totalInserted);
  console.log('Duplicate groups (per-law check):', validation.duplicatePairs);
  console.log('Empty content (batch laws):', validation.emptyContent);
  console.log('Civil Code regression:', validation.civilRegression ? 'yes (unchanged)' : 'NO');
  console.log('Sensitive samples:', JSON.stringify(validation.sensitiveSamples, null, 2));

  await db.destroy();
  process.exit(validation.pass ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  try {
    await db.destroy();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
