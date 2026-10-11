const db = require('../db/connection');
const { AppError } = require('../utils/response');
const { mapTemplateOut } = require('../utils/mappers');
const { insertReturningId } = require('../utils/dbHelpers');
const {
  SYSTEM_LEGAL_TEMPLATES,
  getSystemBySlug,
  mapSystemTemplate
} = require('../data/systemLegalTemplates');
const {
  classifyVariables,
  renderTemplateBody,
  findUnfilledVariables,
  sanitizeTemplateBody,
  assertBodySafe,
  ALLOWED_VARIABLES
} = require('./templateVariables');
const { resolvePreviewInput } = require('./templateContext.service');

const CATEGORIES = [
  'petition',
  'pleading',
  'declaration',
  'contract',
  'court_request',
  'office',
  'letter',
  'power_of_attorney',
  'other'
];

const ALLOWED_PICK = new Set(['title', 'body', 'content', 'text', 'category', 'cat']);

function pick(body = {}) {
  if (body.owner_id != null || body.is_system != null || body.isSystem != null) {
    throw new AppError('فیلدهای سیستمی قابل تغییر نیستند', 400);
  }
  return {
    title: body.title != null ? String(body.title).trim() : '',
    body:
      body.body != null
        ? String(body.body)
        : body.content != null
          ? String(body.content)
          : body.text != null
            ? String(body.text)
            : '',
    category: body.category || body.cat || 'other'
  };
}

function validatePayload(data) {
  if (!data.title) throw new AppError('عنوان قالب الزامی است', 400);
  if (!data.body || !String(data.body).trim()) {
    throw new AppError('متن قالب نمی‌تواند خالی باشد', 400);
  }
  if (!CATEGORIES.includes(data.category)) {
    throw new AppError('دسته‌بندی قالب نامعتبر است', 400);
  }
  if (data.title.length > 255) throw new AppError('عنوان قالب طولانی است', 400);
  if (data.body.length > 50000) throw new AppError('متن قالب بیش از حد مجاز است', 400);
  assertBodySafe(data.body);
}

function parseTemplateRef(rawId) {
  const s = String(rawId);
  if (s.startsWith('system-')) {
    return { kind: 'system', slug: s.slice(7) };
  }
  const n = Number(rawId);
  if (!Number.isFinite(n) || n <= 0) throw new AppError('شناسه قالب نامعتبر است', 400);
  return { kind: 'user', id: n };
}

function listSystemTemplates(query = {}) {
  let list = SYSTEM_LEGAL_TEMPLATES.map(mapSystemTemplate);
  if (query.category) list = list.filter((t) => t.category === query.category);
  const search = String(query.q || query.search || '').trim().toLowerCase();
  if (search) list = list.filter((t) => t.title.toLowerCase().includes(search));
  return list;
}

async function listUserTemplates(user, query = {}) {
  let q = db('document_templates').where({ owner_id: user.id }).select('*').orderBy('updated_at', 'desc');
  if (query.category) q = q.where({ category: query.category });
  const search = String(query.q || query.search || '').trim();
  if (search) {
    q = q.andWhere('title', 'like', `%${search.replace(/[%_]/g, '')}%`);
  }
  const rows = await q;
  return rows.map(mapTemplateOut);
}

async function listTemplates(user, query = {}) {
  const scope = String(query.scope || 'all').toLowerCase();
  if (scope === 'system') return listSystemTemplates(query);
  if (scope === 'mine' || scope === 'user') return listUserTemplates(user, query);
  return [...listSystemTemplates(query), ...(await listUserTemplates(user, query))];
}

async function getUserTemplateRow(id, user) {
  const row = await db('document_templates').where({ id }).first();
  if (!row) return null;
  if (row.is_system) return row;
  if (user.role !== 'admin' && row.owner_id !== user.id) return null;
  return row;
}

async function getTemplate(id, user) {
  const ref = parseTemplateRef(id);
  if (ref.kind === 'system') {
    const sys = getSystemBySlug(ref.slug);
    if (!sys) throw new AppError('قالب یافت نشد', 404);
    return mapSystemTemplate(sys);
  }
  const row = await getUserTemplateRow(ref.id, user);
  if (!row) throw new AppError('قالب یافت نشد', 404);
  return mapTemplateOut(row);
}

async function createTemplate(body, user) {
  const data = pick(body);
  validatePayload(data);
  data.body = sanitizeTemplateBody(data.body);
  validatePayload(data);
  const id = await insertReturningId(db, 'document_templates', {
    owner_id: user.id,
    title: data.title,
    body: data.body.trim(),
    category: data.category,
    is_system: false,
    source_template_id: body.source_template_id ?? body.sourceTemplateId ?? null,
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });
  return getTemplate(id, user);
}

async function updateTemplate(id, body, user) {
  const ref = parseTemplateRef(id);
  if (ref.kind === 'system') {
    throw new AppError('قالب آماده سیستمی قابل ویرایش مستقیم نیست؛ نسخه شخصی بسازید', 403, {
      code: 'SYSTEM_TEMPLATE_READONLY'
    });
  }
  const row = await getUserTemplateRow(ref.id, user);
  if (!row) throw new AppError('قالب یافت نشد', 404);
  if (row.is_system) {
    throw new AppError('قالب سیستمی قابل ویرایش نیست', 403, { code: 'SYSTEM_TEMPLATE_READONLY' });
  }
  const data = pick(body);
  validatePayload(data);
  data.body = sanitizeTemplateBody(data.body);
  validatePayload(data);
  await db('document_templates')
    .where({ id: ref.id })
    .update({
      title: data.title,
      body: data.body.trim(),
      category: data.category,
      updated_at: db.fn.now()
    });
  return getTemplate(ref.id, user);
}

async function deleteTemplate(id, user) {
  const ref = parseTemplateRef(id);
  if (ref.kind === 'system') {
    throw new AppError('قالب آماده سیستمی قابل حذف نیست', 403, { code: 'SYSTEM_TEMPLATE_READONLY' });
  }
  const row = await getUserTemplateRow(ref.id, user);
  if (!row) throw new AppError('قالب یافت نشد', 404);
  if (row.is_system) {
    throw new AppError('قالب سیستمی قابل حذف نیست', 403, { code: 'SYSTEM_TEMPLATE_READONLY' });
  }
  await db('document_templates').where({ id: ref.id }).del();
  return { ok: true };
}

async function duplicateTemplate(id, user, body = {}) {
  const source = await getTemplate(id, user);
  const title =
    String(body.title || '').trim() ||
    `${source.title} (نسخه شخصی)`;
  const editedBody = body.body ?? body.content ?? body.text;
  const payload = {
    title: title.slice(0, 255),
    body: editedBody != null && String(editedBody).trim() ? String(editedBody) : source.body,
    category: body.category || body.cat || source.category
  };
  const created = await createTemplate(payload, user);
  if (source.isSystem && (source.usageNotes || source.usage_notes)) {
    try {
      await db('document_templates')
        .where({ id: created.id })
        .update({ usage_notes: source.usageNotes || source.usage_notes });
    } catch {
      /* usage_notes column optional */
    }
  }
  return getTemplate(created.id, user);
}

async function previewTemplate(body, user) {
  const text = body.body ?? body.content ?? body.text ?? '';
  assertBodySafe(text);
  const values = await resolvePreviewInput(user, body);
  const classification = classifyVariables(text);
  const rendered = renderTemplateBody(text, values);
  const unfilled = findUnfilledVariables(text, values);
  return {
    rendered,
    values,
    variables: classification,
    unfilled,
    allowedVariables: ALLOWED_VARIABLES
  };
}

module.exports = {
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  duplicateTemplate,
  previewTemplate,
  CATEGORIES,
  ALLOWED_PICK
};
