const express = require('express');
const ctrl = require('../controllers/laws.controller');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/validate');

const router = express.Router();

router.use(authenticate);

router.get('/meta', asyncHandler(ctrl.meta));
router.get('/saved', asyncHandler(ctrl.listSaved));
router.get('/search', asyncHandler(ctrl.search));
router.get('/articles/:articleId', asyncHandler(ctrl.getArticle));
router.post('/articles/:articleId/save', asyncHandler(ctrl.saveArticle));
router.delete('/articles/:articleId/save', asyncHandler(ctrl.unsaveArticle));
router.get('/:id/articles', asyncHandler(ctrl.listArticles));
router.get('/:id', asyncHandler(ctrl.getLaw));
router.get('/', asyncHandler(ctrl.list));

module.exports = router;
