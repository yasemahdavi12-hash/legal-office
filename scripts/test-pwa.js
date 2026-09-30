/**
 * PWA + regression smoke tests (dev server on PORT).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 3000);
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@legal.ir';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ChangeThisAdminPass1';
const results = [];

function req(method, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
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
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          const text = buf.toString('utf8');
          let json = null;
          try { json = JSON.parse(text); } catch { /* not json */ }
          resolve({ status: res.statusCode, headers: res.headers, text, json, buf });
        });
      }
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function assert(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

async function main() {
  console.log(`\nPWA tests → http://127.0.0.1:${PORT}\n`);

  // Manifest
  const man = await req('GET', '/manifest.json');
  assert('manifest status 200', man.status === 200, String(man.status));
  assert('manifest content-type', /manifest|json/i.test(man.headers['content-type'] || ''), man.headers['content-type']);
  const m = man.json;
  assert('manifest name', m && m.name === 'قانون در جیب شما');
  assert('manifest short_name', m && m.short_name === 'قانون');
  assert('manifest start_url /', m && m.start_url === '/');
  assert('manifest scope /', m && m.scope === '/');
  assert('manifest display standalone', m && m.display === 'standalone');
  assert('manifest theme_color', m && m.theme_color === '#0f2540');
  assert('manifest background_color', m && m.background_color === '#0f2540');
  const sizes = (m.icons || []).map((i) => i.sizes);
  assert('manifest icon 192', sizes.includes('192x192'));
  assert('manifest icon 512', sizes.includes('512x512'));
  assert('manifest maskable', (m.icons || []).some((i) => String(i.purpose).includes('maskable')));
  assert('manifest icon paths absolute', (m.icons || []).every((i) => String(i.src).startsWith('/')));

  // Icons on disk + HTTP
  for (const icon of ['/icon-192.png', '/icon-512.png']) {
    const r = await req('GET', icon);
    assert(`serve ${icon}`, r.status === 200 && r.buf.length > 100, `status ${r.status} bytes ${r.buf.length}`);
  }
  assert('icon-192 file exists', fs.existsSync(path.join(__dirname, '..', 'icon-192.png')));
  assert('icon-512 file exists', fs.existsSync(path.join(__dirname, '..', 'icon-512.png')));

  // Service worker
  const sw = await req('GET', '/sw.js');
  assert('sw.js status 200', sw.status === 200);
  assert('sw Service-Worker-Allowed', sw.headers['service-worker-allowed'] === '/');
  assert('sw no-cache header', /no-cache/i.test(sw.headers['cache-control'] || ''));
  assert('sw blocks /api cache', /isApiRequest|isPrivatePath|\/api\//.test(sw.text));
  assert('sw never caches Authorization', /Authorization/.test(sw.text));
  assert('sw has offline fallback', /offline\.html/.test(sw.text));
  assert('sw no token cache intent', !/legal_token|refreshToken|accessToken/.test(sw.text));

  const off = await req('GET', '/offline.html');
  assert('offline.html available', off.status === 200 && /آفلاین|اینترنت/.test(off.text));

  // index PWA hooks (no design audit — just functional tags)
  const idx = await req('GET', '/');
  assert('index serves', idx.status === 200);
  assert('index has manifest link', /rel=["']manifest["'][^>]*href=["']\/manifest\.json["']/i.test(idx.text) || /href=["']\/manifest\.json["'][^>]*rel=["']manifest["']/i.test(idx.text) || /manifest\.json/.test(idx.text));
  assert('index theme-color', /theme-color[^>]+#0f2540/i.test(idx.text));
  assert('index registers /sw.js', /serviceWorker\.register\(\s*['"]\/sw\.js['"]/.test(idx.text));
  assert('index apple-touch-icon', /apple-touch-icon/.test(idx.text));

  // HTTPS posture for production API base (relative/origin-based)
  assert(
    'production API uses location.origin (HTTPS-safe)',
    /location\.origin\s*\+\s*['"]\/api['"]/.test(idx.text)
  );
  assert('no hardcoded https-insecure prod API host', !/http:\/\/(?!localhost|127\.0\.0\.1)/i.test(idx.text));

  // Installability checklist (server-side proxies)
  assert(
    'installability: icons + standalone + sw + start_url',
    m.display === 'standalone' && m.start_url === '/' && sizes.includes('192x192') && sizes.includes('512x512') && sw.status === 200
  );

  // Regression: auth + password reset + admin + documents path not precached
  const login = await req('POST', '/api/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  assert('login works', login.status === 200 && !!login.json?.accessToken, `status ${login.status}`);
  const access = login.json.accessToken;
  const refresh = login.json.refreshToken;

  const refreshRes = await req('POST', '/api/refresh', { refreshToken: refresh });
  assert('refresh works', refreshRes.status === 200 && !!refreshRes.json?.accessToken, `status ${refreshRes.status}`);

  const cases = await req('GET', '/api/cases', null, { Authorization: 'Bearer ' + (refreshRes.json.accessToken || access) });
  assert('cases API works', cases.status === 200, `status ${cases.status}`);

  const forgot = await req('POST', '/api/auth/forgot-password', { email: ADMIN_EMAIL });
  assert(
    'password reset forgot intact',
    (forgot.status === 200 && !!forgot.json?.message) || forgot.status === 429,
    `status ${forgot.status}`
  );

  const adminPage = await req('GET', '/admin');
  assert('admin route intact', adminPage.status === 200 && /admin/i.test(adminPage.text));

  const logout = await req('POST', '/api/logout', { refreshToken: refreshRes.json.refreshToken || refresh }, {
    Authorization: 'Bearer ' + (refreshRes.json.accessToken || access)
  });
  assert('logout works', logout.status === 200 || logout.status === 204 || logout.status === 200, `status ${logout.status}`);

  // Ensure private API paths are not in precache list
  const precacheBlock = (sw.text.match(/PRECACHE_URLS\s*=\s*\[[\s\S]*?\];/) || [''])[0];
  assert('sw does not precache /api', precacheBlock && !/\/api\//.test(precacheBlock));
  assert('sw does not precache documents storage', !/storage\/uploads/.test(precacheBlock));

  // Document download should remain network-only (route exists; unauth → 401/404 ok)
  const doc = await req('GET', '/api/documents/1/download');
  assert(
    'document download not publicly cacheable shell',
    doc.status === 401 || doc.status === 404 || doc.status === 400,
    `status ${doc.status}`
  );

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n=== ${passed} passed / ${failed} failed / ${results.length} total ===\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
