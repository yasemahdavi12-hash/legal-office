const db = require('../db/connection');
const { AppError } = require('../utils/response');
const { listCatalog, getTool } = require('./legalTools/registry');
const calculators = require('./legalTools/calculators');
const { getMehrApiDisclaimer } = require('./legalTools/mehrIndex/calculatePure');

function assertLawyerPanel(user) {
  if (!user || user.role === 'client') {
    throw new AppError('دسترسی مجاز نیست', 403);
  }
}

async function getRelatedArticles(toolSlug) {
  const rows = await db('legal_tool_law_links as l')
    .join('law_articles as a', 'a.id', 'l.law_article_id')
    .join('laws as w', 'w.id', 'a.law_id')
    .where('l.tool_slug', toolSlug)
    .select(
      'a.id as articleId',
      'a.article_number as articleNumber',
      'a.title as articleTitle',
      'w.id as lawId',
      'w.title as lawTitle',
      'l.label as linkLabel'
    );
  return rows.map((r) => ({
    articleId: r.articleId,
    articleNumber: r.articleNumber,
    articleTitle: r.articleTitle,
    lawId: r.lawId,
    lawTitle: r.lawTitle,
    linkLabel: r.linkLabel || null
  }));
}

async function listTools(user) {
  assertLawyerPanel(user);
  const { categories, tools } = listCatalog();
  const withLinks = await Promise.all(
    tools.map(async (t) => ({
      ...t,
      relatedArticles: t.status === 'ready' ? await getRelatedArticles(t.slug) : []
    }))
  );
  return { categories, tools: withLinks };
}

async function getToolDetail(slug, user) {
  assertLawyerPanel(user);
  const tool = getTool(slug);
  if (!tool) throw new AppError('ابزار یافت نشد', 404);
  const relatedArticles =
    tool.status === 'ready' ? await getRelatedArticles(slug) : [];
  const relatedTools = [];
  if (relatedArticles.length) {
    relatedTools.push({ slug, title: tool.title });
  }
  return { ...tool, relatedArticles, relatedTools };
}

async function runCalculation(slug, body, user) {
  assertLawyerPanel(user);
  const tool = getTool(slug);
  if (!tool) throw new AppError('ابزار یافت نشد', 404);
  if (tool.status !== 'ready') {
    throw new AppError('این ابزار هنوز فعال نیست', 400, { code: 'TOOL_NOT_READY' });
  }
  const result = await calculators.calculate(slug, body);
  const relatedArticles = await getRelatedArticles(slug);
  const payload = {
    tool: { slug: tool.slug, title: tool.title, legalBasis: tool.legalBasis },
    result,
    relatedArticles
  };
  if (slug === 'mehr-calc') {
    payload.disclaimer = getMehrApiDisclaimer();
  }
  return payload;
}

module.exports = {
  listTools,
  getToolDetail,
  runCalculation,
  assertLawyerPanel
};
