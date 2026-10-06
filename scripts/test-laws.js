/**
 * Laws library — schema, search, bookmarks, no fake content required.
 */
require('dotenv').config();

const http = require('http');
const db = require('../src/db/connection');
const { createApp } = require('../src/app');

let PORT = 0;
let server;
const results = [];

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
        res.on('data', (c) => { raw += c; });
        res.on('end', () => {
          let json = null;
          try { json = raw ? JSON.parse(raw) : null; } catch { json = { raw }; }
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
  const email = `law.${tag}@test.local`;
  const password = 'LawLibPass99';
  await req('POST', '/api/register', { name: 'Law ' + tag, email, password, role: 'lawyer' });
  const login = await req('POST', '/api/login', { email, password });
  return { email, token: login.body.accessToken, userId: login.body.user?.id };
}

async function main() {
  await db.migrate.latest();
  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  PORT = server.address().port;

  const lawyer = await registerLawyer('lib');

  const meta = await req('GET', '/api/laws/meta', null, auth(lawyer.token));
  assert('meta 200', meta.status === 200);
  assert('categories present', (meta.body.categories || []).length >= 10);

  const empty = await req('GET', '/api/laws', null, auth(lawyer.token));
  assert('list empty ok', empty.status === 200 && Array.isArray(empty.body));

  const [lawId] = await db('laws').insert({
    title: 'قانون نمونه تست (غیر واقعی — فقط fixture)',
    category: 'other',
    approval_date: null,
    source: 'test-fixture',
    description: 'فقط برای تست API'
  });

  const [articleId] = await db('law_articles').insert({
    law_id: lawId,
    article_number: '1',
    title: 'ماده آزمایشی',
    content: 'متن fixture برای جستجو کلمهٔ uniqueXYZ123',
    source: 'test-fixture'
  });

  await db('legal_tool_law_links').insert({
    tool_slug: 'date-diff',
    law_article_id: articleId,
    label: 'پیوند تست'
  });

  const search = await req('GET', '/api/laws/search?q=uniqueXYZ123', null, auth(lawyer.token));
  assert('search hit', search.status === 200 && search.body[0]?.id === articleId);

  const art = await req('GET', '/api/laws/articles/' + articleId, null, auth(lawyer.token));
  assert('article detail', art.status === 200 && art.body.relatedTools?.[0]?.slug === 'date-diff');

  const save = await req('POST', '/api/laws/articles/' + articleId + '/save', {}, auth(lawyer.token));
  assert('save article', save.status === 200 && save.body.saved === true);

  const saved = await req('GET', '/api/laws/saved', null, auth(lawyer.token));
  assert('list saved', saved.status === 200 && saved.body.length === 1);

  const other = await registerLawyer('other');
  const idor = await req('GET', '/api/laws/articles/' + articleId, null, auth(other.token));
  assert('other lawyer can read article', idor.status === 200);

  await db('user_law_article_saves').where({ law_article_id: articleId }).delete();
  await db('legal_tool_law_links').where({ law_article_id: articleId }).delete();
  await db('law_articles').where({ id: articleId }).delete();
  await db('laws').where({ id: lawId }).delete();

  server.close();
  const failed = results.filter((r) => !r.ok);
  console.log('\n' + (failed.length ? 'FAIL' : 'PASS') + `  laws ${results.filter((r) => r.ok).length}/${results.length}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
