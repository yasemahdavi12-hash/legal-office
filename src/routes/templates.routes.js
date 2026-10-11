const express = require('express');
const ctrl = require('../controllers/template.controller');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/validate');
const { templates } = require('../validators/crud');

const router = express.Router();
router.use(authenticate);
router.get('/variables', asyncHandler(ctrl.listVariables));
router.get('/', templates.listQuery, asyncHandler(ctrl.list));
router.post('/preview', templates.preview, asyncHandler(ctrl.preview));
router.post('/', templates.create, asyncHandler(ctrl.create));
router.post('/:id/duplicate', templates.id, asyncHandler(ctrl.duplicate));
router.get('/:id', templates.id, asyncHandler(ctrl.get));
router.put('/:id', templates.update, asyncHandler(ctrl.update));
router.delete('/:id', templates.id, asyncHandler(ctrl.remove));
module.exports = router;
