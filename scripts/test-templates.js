/**
 * Legal document templates — CRUD, system/user, variables, security, UI markers.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const db = require('../src/db/connection');
const { createApp } = require('../src/app');
const {
  classifyVariables,
  renderTemplateBody,
  assertBodySafe
} = require('../src/services/templateVariables');
const { SYSTEM_LEGAL_TEMPLATES } = require('../src/data/systemLegalTemplates');

let PORT = 0;
let server;
const results = [];

function assert(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

function req(method, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : JSON.stringify(body);
    const r = http.request(
      {
        hostname: '127.0.0.1',
        port: PORT,
        path: urlPath,
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
  const email = `tpl.${tag}.${Date.now()}@test.local`;
  const password = 'TplLawyerPass99';
  await req('POST', '/api/register', { name: 'Tpl ' + tag, email, password, role: 'lawyer' });
  const login = await req('POST', '/api/login', { email, password });
  return login.body.accessToken;
}

function runUnitVariableTests() {
  const c = classifyVariables('سلام {{client_name}} و {{bad_var}}');
  assert('variable known', c.known.includes('client_name'));
  assert('variable unknown detected', c.unknown.includes('bad_var'));
  const rendered = renderTemplateBody('{{lawyer_name}}', { lawyer_name: 'Ali' });
  assert('variable render', rendered === 'Ali');
  try {
    assertBodySafe('<script>alert(1)</script>');
    assert('xss body rejected', false);
  } catch (e) {
    assert('xss body rejected', e.status === 400);
  }
}

function runUiStaticTests() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert('UI tpl-search', html.includes('id="tpl-search"'));
  assert('UI tpl-text editable', html.includes('id="tpl-text"') && !html.includes('readonly></textarea>'));
  assert('UI previewTemplateDoc', html.includes('function previewTemplateDoc'));
  assert('UI printTemplateDoc', html.includes('function printTemplateDoc'));
  assert('UI downloadTemplateTxt', html.includes('function downloadTemplateTxt'));
  assert('UI download text button', html.includes('دانلود متن'));
  assert('UI template scope tabs', html.includes('setTemplateScope'));
  assert('UI system duplicate', html.includes('duplicateTemplateFromEditor'));
  assert('UI mobile media query', html.includes('max-width:720px'));
}

async function main() {
  runUnitVariableTests();
  runUiStaticTests();
  assert('system catalog count', SYSTEM_LEGAL_TEMPLATES.length >= 15);

  await db.migrate.latest();
  assert('migration document_templates', await db.schema.hasTable('document_templates'));

  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  PORT = server.address().port;

  const tokenA = await registerLawyer('a');
  const tokenB = await registerLawyer('b');

  const vars = await req('GET', '/api/templates/variables', null, auth(tokenA));
  assert('GET variables', vars.status === 200 && vars.body.variables?.includes('client_name'));

  const listAll = await req('GET', '/api/templates', null, auth(tokenA));
  assert('GET list all', listAll.status === 200 && listAll.body.length >= SYSTEM_LEGAL_TEMPLATES.length);

  const listSys = await req('GET', '/api/templates?scope=system', null, auth(tokenA));
  assert('GET list system scope', listSys.status === 200 && listSys.body.length === SYSTEM_LEGAL_TEMPLATES.length);

  const sysId = 'system-petition-debt';
  const sysGet = await req('GET', '/api/templates/' + sysId, null, auth(tokenA));
  assert('GET system template', sysGet.status === 200 && sysGet.body.isSystem);

  const sysPut = await req(
    'PUT',
    '/api/templates/' + sysId,
    { title: 'x', body: 'y', category: 'petition' },
    auth(tokenA)
  );
  assert('PUT system forbidden', sysPut.status === 403, JSON.stringify(sysPut.body));

  const sysDel = await req('DELETE', '/api/templates/' + sysId, null, auth(tokenA));
  assert('DELETE system forbidden', sysDel.status === 403);

  const dup = await req('POST', '/api/templates/' + sysId + '/duplicate', { title: 'نسخه من' }, auth(tokenA));
  assert('duplicate system 201', dup.status === 201 && dup.body.title === 'نسخه من' && !dup.body.isSystem);
  const personalId = dup.body.id;

  const updated = await req(
    'PUT',
    '/api/templates/' + personalId,
    { title: 'ویرایش‌شده', body: 'متن {{client_name}} جدید', category: 'pleading' },
    auth(tokenA)
  );
  assert('PUT personal body', updated.status === 200 && updated.body.body.includes('{{client_name}}'));

  const reload = await req('GET', '/api/templates/' + personalId, null, auth(tokenA));
  assert('GET reload personal', reload.status === 200 && reload.body.title === 'ویرایش‌شده');

  const preview = await req(
    'POST',
    '/api/templates/preview',
    { body: 'سلام {{client_name}} {{unknown_x}}', variables: { client_name: 'رضا' } },
    auth(tokenA)
  );
  assert('preview render', preview.status === 200 && preview.body.rendered.includes('رضا'));
  assert('preview unknown var', preview.body.variables?.unknown?.includes('unknown_x'));
  assert('preview unfilled', Array.isArray(preview.body.unfilled));

  const badXss = await req(
    'POST',
    '/api/templates',
    { title: 'x', body: '<script>x</script>متن', category: 'other' },
    auth(tokenA)
  );
  assert('POST xss 400', badXss.status === 400);

  const mass = await req(
    'POST',
    '/api/templates',
    { title: 'm', body: 'ok', category: 'other', owner_id: 999, is_system: true },
    auth(tokenA)
  );
  assert('POST mass assignment blocked', mass.status === 400);

  const big = await req(
    'POST',
    '/api/templates',
    { title: 'b', body: 'x'.repeat(50001), category: 'other' },
    auth(tokenA)
  );
  assert('POST overflow body', big.status === 400);

  const idor = await req('GET', '/api/templates/' + personalId, null, auth(tokenB));
  assert('IDOR read 404', idor.status === 404);

  const idorDel = await req('DELETE', '/api/templates/' + personalId, null, auth(tokenB));
  assert('IDOR delete 404', idorDel.status === 404);

  const del = await req('DELETE', '/api/templates/' + personalId, null, auth(tokenA));
  assert('DELETE personal', del.status === 200);

  const noAuth = await req('GET', '/api/templates');
  assert('no auth 401', noAuth.status === 401);

  server.close();
  const failed = results.filter((r) => !r.ok);
  console.log('\n---');
  console.log(`${failed.length ? 'FAIL' : 'PASS'}  templates ${results.length - failed.length}/${results.length}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
