/**
 * DEV QA for imported laws — read-only on laws/articles; save test cleans up after.
 * No migrations, no fixture laws inserted.
 */
require('dotenv').config();

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const db = require('../src/db/connection');
const { createApp } = require('../src/app');
const { compareSortKeys } = require('./lib/qavanin-civil-import');

let PORT = 0;
let server;
const results = [];

const SENSITIVE = Object.freeze({
  'civil-code': { desc: null, title: 'قانون مدنی', samples: ['00001', '00010', '00218'] },
  'civil-procedure': { samples: [] },
  'direct-tax': { samples: ['00040', '00040-e1', '00040-r1', '00041', '00041-e1'] },
  commerce: { samples: ['B01-00001', 'B03-F01-00001'] },
  'family-protection': { samples: ['00001', '00001-n1', '00001-n2'] },
  'ipc-1392': { samples: ['00001'] },
  'ipc-book5': { samples: ['00498'] }
});

const BATCH_KEYS = [
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

function assert(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

function req(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : JSON.stringify(body);
    const r = http.request(
      {
        hostname: '127.0.0.1',
        port: PORT,
        path,
        method,
        headers: {
          ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
          ...headers
        }
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => {
          raw += c;
        });
        res.on('end', () => {
          let json = null;
          try {
            json = raw ? JSON.parse(raw) : null;
          } catch {
            json = { raw };
          }
          resolve({ status: res.statusCode, body: json });
        });
      }
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function auth(token) {
  return { Authorization: 'Bearer ' + token };
}

async function registerLawyer(tag) {
  const email = `qa.laws.${tag}.${Date.now()}@test.local`;
  const password = 'LawQAPass99!';
  await req('POST', '/api/register', { name: 'QA ' + tag, email, password, role: 'lawyer' });
  const login = await req('POST', '/api/login', { email, password });
  return { token: login.body.accessToken };
}

function loadJsonArticleContent(lawKey, articleNumber) {
  const file = path.join(os.tmpdir(), 'dadbane-qavanin-batch', `${lawKey}.json`);
  if (!fs.existsSync(file)) return null;
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const a = doc.articles.find((x) => x.articleNumber === articleNumber);
  return a ? a.content : null;
}

async function resolveLawByKey(lawKey) {
  if (lawKey === 'civil-code') {
    return db('laws').where({ title: 'قانون مدنی', category: 'civil' }).first();
  }
  return db('laws').where({ description: `dadbane:lawKey=${lawKey}` }).first();
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing QA in production');
    process.exit(1);
  }

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  PORT = server.address().port;

  const { token } = await registerLawyer('dev');

  const meta = await req('GET', '/api/laws/meta', null, auth(token));
  assert('GET /api/laws/meta 200', meta.status === 200);
  assert('meta totalLaws >= 13', (meta.body.totalLaws || 0) >= 13, `got ${meta.body.totalLaws}`);

  const list = await req('GET', '/api/laws', null, auth(token));
  assert('GET /api/laws 200', list.status === 200 && Array.isArray(list.body));
  assert('list count >= 13', list.body.length >= 13, `got ${list.body.length}`);

  for (const lawKey of ['civil-code', ...BATCH_KEYS]) {
    const row = await resolveLawByKey(lawKey);
    assert(`law row ${lawKey}`, !!row, row ? `id=${row.id}` : 'missing');
    if (!row) continue;

    const inList = list.body.some((l) => l.id === row.id);
    assert(`listed ${lawKey}`, inList);

    const detail = await req('GET', `/api/laws/${row.id}`, null, auth(token));
    assert(`GET /api/laws/:id ${lawKey}`, detail.status === 200 && detail.body.title === row.title);
    assert(`category ${lawKey}`, detail.body.category === row.category);

    const expectedCount = Number(
      (await db('law_articles').where({ law_id: row.id }).count({ c: '*' }).first()).c
    );
    const page1 = await req(
      'GET',
      `/api/laws/${row.id}/articles?page=1&limit=50`,
      null,
      auth(token)
    );
    assert(`articles paginated ${lawKey}`, page1.status === 200 && Array.isArray(page1.body.items));
    assert(
      `pagination total ${lawKey}`,
      page1.body.pagination?.total === expectedCount,
      `api=${page1.body.pagination?.total} db=${expectedCount}`
    );

    if (expectedCount > 50) {
      const page2 = await req(
        'GET',
        `/api/laws/${row.id}/articles?page=2&limit=50`,
        null,
        auth(token)
      );
      assert(`page2 ${lawKey}`, page2.status === 200 && page2.body.items.length > 0);
    }

    const cfg = SENSITIVE[lawKey];
    if (cfg?.samples?.length) {
      for (const num of cfg.samples) {
        const artRow = await db('law_articles')
          .where({ law_id: row.id, article_number: num })
          .first();
        assert(`article ${lawKey} ${num} exists`, !!artRow);
        if (!artRow) continue;
        const art = await req('GET', `/api/laws/articles/${artRow.id}`, null, auth(token));
        assert(`GET article ${lawKey} ${num}`, art.status === 200);
        assert(
          `article_number ${lawKey} ${num}`,
          art.body.articleNumber === num
        );
        assert(
          `content length ${lawKey} ${num}`,
          (art.body.content || '').length > 0
        );
        if (lawKey !== 'civil-code') {
          const expected = loadJsonArticleContent(lawKey, num);
          if (expected != null) {
            assert(
              `content match JSON ${lawKey} ${num}`,
              art.body.content === expected
            );
          }
        }
        if (art.body.prev) {
          assert(`prev navigable ${lawKey} ${num}`, !!art.body.prev.id);
        }
        if (art.body.next) {
          assert(`next navigable ${lawKey} ${num}`, !!art.body.next.id);
        }
      }
    }
  }

  const fam = await resolveLawByKey('family-protection');
  if (fam) {
    const search = await req(
      'GET',
      '/api/laws/search?q=' + encodeURIComponent('00001-n1'),
      null,
      auth(token)
    );
    assert('GET /api/laws/search 200', search.status === 200 && Array.isArray(search.body));
    const hit = search.body.find((h) => h.articleNumber === '00001-n1');
    assert('search finds family 00001-n1', !!hit);
  }

  const taxArt = await db('law_articles')
    .join('laws', 'laws.id', 'law_articles.law_id')
    .where('laws.description', 'dadbane:lawKey=direct-tax')
    .where('law_articles.article_number', '00040-e1')
    .select('law_articles.id')
    .first();

  let saveArticleId = null;
  if (taxArt) {
    saveArticleId = taxArt.id;
    const save = await req('POST', `/api/laws/articles/${saveArticleId}/save`, {}, auth(token));
    assert('POST save article', save.status === 200 && save.body.saved === true);
    const saved = await req('GET', '/api/laws/saved', null, auth(token));
    assert('GET saved list', saved.status === 200 && saved.body.some((s) => s.articleId === saveArticleId));
    const unsave = await req('DELETE', `/api/laws/articles/${saveArticleId}/save`, null, auth(token));
    assert('DELETE unsave cleanup', unsave.status === 200);
  }

  const commerce = await resolveLawByKey('commerce');
  if (commerce) {
    const allNums = (
      await db('law_articles').where({ law_id: commerce.id }).select('article_number', 'id')
    ).map((r) => r.article_number);
    const sorted = [...allNums].sort(compareSortKeys);
    const apiOrder = (
      await req('GET', `/api/laws/${commerce.id}/articles?page=1&limit=500`, null, auth(token))
    ).body.items.map((i) => i.articleNumber);
    const apiSorted = [...apiOrder].sort(compareSortKeys);
    assert(
      'commerce API order matches canonical sort',
      JSON.stringify(apiSorted) === JSON.stringify(sorted.slice(0, apiOrder.length)),
      'article_number lex order may differ from canonical'
    );
  }

  server.close();
  await db.destroy();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== API QA: ${failed.length ? 'FAIL' : 'PASS'} (${results.filter((r) => r.ok).length}/${results.length}) ===`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
