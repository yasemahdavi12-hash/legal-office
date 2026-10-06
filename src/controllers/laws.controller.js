const lawsService = require('../services/laws.service');
const { ok } = require('../utils/response');

async function meta(req, res) {
  return ok(res, await lawsService.listMeta(req.user));
}

async function list(req, res) {
  return ok(res, await lawsService.listLaws(req.user, req.query || {}));
}

async function getLaw(req, res) {
  return ok(res, await lawsService.getLaw(Number(req.params.id), req.user));
}

async function listArticles(req, res) {
  return ok(res, await lawsService.listArticles(Number(req.params.id), req.user, req.query || {}));
}

async function search(req, res) {
  return ok(res, await lawsService.searchArticles(req.user, req.query || {}));
}

async function getArticle(req, res) {
  return ok(res, await lawsService.getArticle(Number(req.params.articleId), req.user));
}

async function saveArticle(req, res) {
  return ok(res, await lawsService.saveArticle(Number(req.params.articleId), req.user));
}

async function unsaveArticle(req, res) {
  return ok(res, await lawsService.unsaveArticle(Number(req.params.articleId), req.user));
}

async function listSaved(req, res) {
  return ok(res, await lawsService.listSaved(req.user));
}

module.exports = {
  meta,
  list,
  getLaw,
  listArticles,
  search,
  getArticle,
  saveArticle,
  unsaveArticle,
  listSaved
};
