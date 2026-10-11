const db = require('../db/connection');
const { AppError } = require('../utils/response');
const { assertLawyerPanel } = require('./legalTools.service');
const { getTool } = require('./legalTools/registry');

const CATEGORIES = Object.freeze([
  { id: 'civil', title: 'قانون مدنی' },
  { id: 'ipc', title: 'قانون مجازات اسلامی' },
  { id: 'civil_procedure', title: 'قانون آیین دادرسی مدنی' },
  { id: 'criminal_procedure', title: 'قانون آیین دادرسی کیفری' },
  { id: 'commerce', title: 'قانون تجارت' },
  { id: 'registration', title: 'قانون ثبت اسناد و املاک' },
  { id: 'family', title: 'قوانین خانواده' },
  { id: 'labor', title: 'قانون کار' },
  { id: 'social_security', title: 'قوانین تأمین اجتماعی' },
  { id: 'tax', title: 'قوانین مالیاتی' },
  { id: 'cheque', title: 'قوانین چک' },
  { id: 'companies', title: 'قوانین شرکت‌ها' },
  { id: 'bar', title: 'قوانین وکالت' },
  { id: 'cyber', title: 'قوانین جرایم رایانه‌ای' },
  { id: 'administrative_justice', title: 'قوانین دیوان عدالت اداری' },
  { id: 'property', title: 'قوانین املاک و شهرداری' },
  { id: 'other', title: 'سایر قوانین پرکاربرد' }
]);

function mapLaw(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    approvalDate: row.approval_date || null,
    source: row.source || null,
    description: row.description || null
  };
}

function mapArticle(row, law) {
  if (!row) return null;
  return {
    id: row.id,
    lawId: row.law_id,
    articleNumber: row.article_number,
    title: row.title || null,
    content: row.content,
    source: row.source || null,
    law: law ? mapLaw(law) : undefined
  };
}

async function listMeta(user) {
  assertLawyerPanel(user);
  const counts = await db('laws').count({ c: '*' }).first();
  const totalLaws = Number(counts?.c ?? counts?.count ?? 0);
  return {
    categories: CATEGORIES,
    totalLaws,
    hasContent: totalLaws > 0,
    message: totalLaws
      ? null
      : 'هنوز متن قانونی در سامانه بارگذاری نشده است. پس از import منبع معتبر، جستجو فعال می‌شود.'
  };
}

async function listLaws(user, query = {}) {
  assertLawyerPanel(user);
  let q = db('laws').select('*').orderBy('title', 'asc');
  if (query.category) q = q.where({ category: String(query.category) });
  if (query.q) {
    const term = `%${String(query.q).trim().slice(0, 120)}%`;
    q = q.where((b) => {
      b.where('title', 'like', term).orWhere('description', 'like', term);
    });
  }
  const rows = await q.limit(Math.min(Number(query.limit) || 100, 200));
  return rows.map(mapLaw);
}

async function getLaw(lawId, user) {
  assertLawyerPanel(user);
  const row = await db('laws').where({ id: lawId }).first();
  if (!row) throw new AppError('قانون یافت نشد', 404);
  return mapLaw(row);
}

async function listArticles(lawId, user, query = {}) {
  assertLawyerPanel(user);
  const law = await db('laws').where({ id: lawId }).first();
  if (!law) throw new AppError('قانون یافت نشد', 404);

  const page = Math.max(1, Number.parseInt(String(query.page || '1'), 10) || 1);
  const limit = Math.min(
    100,
    Math.max(1, Number.parseInt(String(query.limit || '50'), 10) || 50)
  );

  let base = db('law_articles').where({ law_id: lawId });
  if (query.q) {
    const term = `%${String(query.q).trim().slice(0, 120)}%`;
    base = base.where((b) => {
      b.where('content', 'like', term)
        .orWhere('title', 'like', term)
        .orWhere('article_number', 'like', term);
    });
  }

  const countRow = await base.clone().count({ c: '*' }).first();
  const total = Number(countRow?.c ?? countRow?.count ?? 0);
  const totalPages = total ? Math.ceil(total / limit) : 0;
  const safePage = totalPages ? Math.min(page, totalPages) : 1;
  const offset = (safePage - 1) * limit;

  const rows = await base
    .clone()
    .orderBy('article_number', 'asc')
    .limit(limit)
    .offset(offset);

  const items = rows.map((r) => ({
    id: r.id,
    articleNumber: r.article_number,
    title: r.title || null,
    excerpt: String(r.content || '').slice(0, 160)
  }));

  return {
    items,
    pagination: {
      page: safePage,
      limit,
      total,
      totalPages,
      hasNext: totalPages > 0 && safePage < totalPages,
      hasPrev: safePage > 1
    }
  };
}

async function searchArticles(user, query = {}) {
  assertLawyerPanel(user);
  const qRaw = String(query.q || '').trim();
  if (!qRaw) return [];
  const term = `%${qRaw.slice(0, 120)}%`;
  const rows = await db('law_articles as a')
    .join('laws as w', 'w.id', 'a.law_id')
    .where((b) => {
      b.where('a.content', 'like', term)
        .orWhere('a.title', 'like', term)
        .orWhere('a.article_number', 'like', term)
        .orWhere('w.title', 'like', term);
    })
    .select('a.*', 'w.title as law_title', 'w.category as law_category')
    .orderBy('w.title', 'asc')
    .limit(50);
  return rows.map((r) => ({
    id: r.id,
    lawId: r.law_id,
    lawTitle: r.law_title,
    lawCategory: r.law_category,
    articleNumber: r.article_number,
    title: r.title || null,
    excerpt: String(r.content || '').slice(0, 200)
  }));
}

async function getArticle(articleId, user) {
  assertLawyerPanel(user);
  const row = await db('law_articles').where({ id: articleId }).first();
  if (!row) throw new AppError('ماده یافت نشد', 404);
  const law = await db('laws').where({ id: row.law_id }).first();
  const saved = await db('user_law_article_saves')
    .where({ user_id: user.id, law_article_id: articleId })
    .first();
  const nav = await articleNav(row.law_id, row.article_number);
  const toolLinks = await db('legal_tool_law_links')
    .where({ law_article_id: articleId })
    .select('tool_slug', 'label');
  const relatedTools = toolLinks
    .map((l) => {
      const t = getTool(l.tool_slug);
      return t ? { slug: t.slug, title: t.title, label: l.label } : null;
    })
    .filter(Boolean);
  return {
    ...mapArticle(row, law),
    saved: !!saved,
    prev: nav.prev,
    next: nav.next,
    relatedTools
  };
}

async function articleNav(lawId, articleNumber) {
  const articles = await db('law_articles')
    .where({ law_id: lawId })
    .orderBy('article_number', 'asc')
    .select('id', 'article_number');
  const idx = articles.findIndex((a) => a.article_number === articleNumber);
  return {
    prev: idx > 0 ? { id: articles[idx - 1].id, articleNumber: articles[idx - 1].article_number } : null,
    next: idx >= 0 && idx < articles.length - 1
      ? { id: articles[idx + 1].id, articleNumber: articles[idx + 1].article_number }
      : null
  };
}

async function saveArticle(articleId, user) {
  assertLawyerPanel(user);
  const row = await db('law_articles').where({ id: articleId }).first();
  if (!row) throw new AppError('ماده یافت نشد', 404);
  const existing = await db('user_law_article_saves')
    .where({ user_id: user.id, law_article_id: articleId })
    .first();
  if (!existing) {
    await db('user_law_article_saves').insert({
      user_id: user.id,
      law_article_id: articleId,
      created_at: db.fn.now()
    });
  }
  return { saved: true };
}

async function unsaveArticle(articleId, user) {
  assertLawyerPanel(user);
  await db('user_law_article_saves')
    .where({ user_id: user.id, law_article_id: articleId })
    .delete();
  return { saved: false };
}

async function listSaved(user) {
  assertLawyerPanel(user);
  const rows = await db('user_law_article_saves as s')
    .join('law_articles as a', 'a.id', 's.law_article_id')
    .join('laws as w', 'w.id', 'a.law_id')
    .where('s.user_id', user.id)
    .orderBy('s.created_at', 'desc')
    .select('a.id as articleId', 'a.article_number', 'a.title as articleTitle', 'w.id as lawId', 'w.title as lawTitle');
  return rows;
}

module.exports = {
  CATEGORIES,
  listMeta,
  listLaws,
  getLaw,
  listArticles,
  searchArticles,
  getArticle,
  saveArticle,
  unsaveArticle,
  listSaved
};
