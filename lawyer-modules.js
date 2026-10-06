/** Shared auth + API helpers for /legal-tools and /laws */
(function (global) {
  const API_BASE = `${location.origin}/api`;

  function getToken() {
    return localStorage.getItem('legal_token') || '';
  }

  async function api(method, path, body) {
    const headers = {};
    const token = getToken();
    if (token) headers.Authorization = 'Bearer ' + token;
    let data = null;
    if (body != null) {
      headers['Content-Type'] = 'application/json';
      data = JSON.stringify(body);
    }
    const res = await fetch(API_BASE + path, { method, headers, body: data });
    let json = null;
    const raw = await res.text();
    try { json = raw ? JSON.parse(raw) : null; } catch { json = { raw }; }
    if (res.status === 401) {
      const next = encodeURIComponent(location.pathname + location.search + location.hash);
      location.href = '/login?next=' + next;
      throw new Error('unauthorized');
    }
    if (!res.ok) {
      const msg = (json && json.error) || 'خطای سرور';
      const err = new Error(msg);
      err.status = res.status;
      err.body = json;
      throw err;
    }
    return json;
  }

  async function requireLawyerSession() {
    const token = getToken();
    if (!token) {
      const next = encodeURIComponent(location.pathname + location.search + location.hash);
      location.href = '/login?next=' + next;
      return null;
    }
    try {
      const me = await api('GET', '/me');
      if (me.role === 'client') {
        location.href = '/portal';
        return null;
      }
      return me;
    } catch (e) {
      if (e.message !== 'unauthorized') throw e;
      return null;
    }
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toast(msg) {
    let el = document.getElementById('mod-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'mod-toast';
      el.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#0f2540;color:#fff;padding:10px 16px;border-radius:8px;font-size:13px;z-index:9999;opacity:0;transition:opacity .2s';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.opacity = '0'; }, 2600);
  }

  global.LawyerModules = { api, getToken, requireLawyerSession, escapeHtml, toast, API_BASE };
})(window);
