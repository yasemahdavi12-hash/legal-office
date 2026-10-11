const http = require('http');
const { createApp } = require('../src/app');

function get(port, path, followRedirect = false) {
  return new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port, path }, (r) => {
      if (followRedirect && r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        const loc = r.headers.location;
        const p = loc.startsWith('http') ? new URL(loc).pathname : loc;
        return get(port, p, false).then((inner) => resolve({ ...inner, redirectedFrom: path, redirectStatus: r.statusCode }));
      }
      let d = '';
      r.on('data', (c) => { d += c; });
      r.on('end', () => {
        const title = (d.match(/<title>([^<]+)/) || [])[1] || '';
        resolve({
          status: r.statusCode,
          title,
          hasAppLayout: d.includes('id="app-layout"'),
          isLanding: title.includes('دادبان') && !d.includes('id="app-layout"')
        });
      });
    });
  });
}

const app = createApp();
const s = app.listen(0, async () => {
  const port = s.address().port;
  const root = await get(port, '/');
  const appPage = await get(port, '/app');
  const laws = await get(port, '/laws');
  const missing = await get(port, '/no-such-route');
  const indexRedirect = await get(port, '/index.html', true);
  console.log(JSON.stringify({ root, appPage, laws, missing, indexRedirect }, null, 2));
  s.close();
});
