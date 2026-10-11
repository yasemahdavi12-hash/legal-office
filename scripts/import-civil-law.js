/**
 * Import قانون مدنی from validated JSON. Default: dry-run (no DB writes).
 *
 *   node scripts/import-civil-law.js --dry-run
 *   node scripts/import-civil-law.js --file path/to.json
 *   node scripts/import-civil-law.js --commit --confirm
 */
require('dotenv').config();

const db = require('../src/db/connection');
const {
  parseCliArgs,
  loadJson,
  validateDocument,
  countTables,
  buildImportPlan,
  executeImport,
  defaultJsonPath
} = require('./lib/civil-law-importer');

function printHelp() {
  console.log(`Usage:
  node scripts/import-civil-law.js [--dry-run] [--file <path>]
  node scripts/import-civil-law.js --commit --confirm [--file <path>]

Default file: ${defaultJsonPath()}
Without both --commit and --confirm: no INSERT/UPDATE/DELETE.`);
}

function safeLogPlan(plan) {
  return {
    lawFound: !!plan.law,
    lawId: plan.lawId,
    lawWouldCreate: plan.lawWouldCreate,
    articlesTotal: plan.articlesTotal,
    existingInDb: plan.existingInDbCount,
    newArticles: plan.newCount,
    skippedExisting: plan.existingInDbCount
  };
}

async function main() {
  const args = parseCliArgs(process.argv);
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  console.log('Mode:', args.mode);
  console.log('JSON file:', args.file);
  if (args.commit && !args.confirm) {
    console.log('Note: --commit without --confirm → dry-run only (no DB writes).');
  }

  const { doc, errors: loadErrors } = loadJson(args.file);
  if (loadErrors.length) {
    console.error('Load errors:', loadErrors.join('; '));
    process.exit(1);
  }

  const validation = validateDocument(doc);
  if (!validation.ok) {
    console.error('Validation errors:');
    validation.errors.forEach((e) => console.error(' -', e));
    console.log('\nFinal result: FAIL (validation)');
    process.exit(1);
  }

  let countsBefore;
  try {
    countsBefore = await countTables(db);
  } catch (err) {
    console.error('DB read failed:', err.message);
    process.exit(1);
  }

  let plan;
  try {
    plan = await buildImportPlan(db, doc);
  } catch (err) {
    console.error('Plan failed:', err.message);
    process.exit(1);
  }

  const summary = safeLogPlan(plan);
  console.log('\n--- Import plan ---');
  console.log('Law found:', summary.lawFound ? 'yes' : 'no');
  if (summary.lawId) console.log('Law id:', summary.lawId);
  console.log('Law would create:', summary.lawWouldCreate ? 'yes' : 'no');
  console.log('Articles total (JSON):', summary.articlesTotal);
  console.log('Existing in DB (skip):', summary.existingInDb);
  console.log('New articles (insert-if-missing):', summary.newArticles);
  console.log('DB counts before — laws:', countsBefore.laws, 'articles:', countsBefore.articles);

  if (!args.willWrite) {
    const lawsAfter = countsBefore.laws + (plan.lawWouldCreate ? 1 : 0);
    const articlesAfter = countsBefore.articles + plan.newCount;
    console.log('\nProjected after commit — laws:', lawsAfter, 'articles:', articlesAfter);
    console.log('Final result: PASS (dry-run, no DB changes)');
    await db.destroy();
    process.exit(0);
  }

  try {
    const result = await executeImport(db, doc, plan);
    const countsAfter = await countTables(db);
    console.log('\n--- Commit completed ---');
    console.log('Law id:', result.lawId);
    console.log('Created law:', result.createdLaw);
    console.log('Inserted articles:', result.insertedArticles);
    console.log('DB counts after — laws:', countsAfter.laws, 'articles:', countsAfter.articles);
    console.log('Final result: PASS (commit)');
  } catch (err) {
    console.error('Import failed (transaction rolled back):', err.message);
    const countsAfter = await countTables(db);
    console.log('DB counts after rollback — laws:', countsAfter.laws, 'articles:', countsAfter.articles);
    console.log('Final result: FAIL (commit)');
    await db.destroy();
    process.exit(1);
  }

  await db.destroy();
  process.exit(0);
}

main().catch(async (err) => {
  console.error(err.message);
  try {
    await db.destroy();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
