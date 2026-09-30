const express = require('express');
const ctrl = require('../controllers/case.controller');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/validate');
const { cases } = require('../validators/crud');

const caseClientAccessRoutes = require('./caseClientAccess.routes');
const caseDocumentShareRoutes = require('./caseDocumentShare.routes');
const caseMessageRoutes = require('./caseMessage.routes');
const caseDocumentRequestRoutes = require('./caseDocumentRequest.routes');
const caseFinanceRoutes = require('./caseFinance.routes');

const router = express.Router();
router.use(authenticate);

router.use('/', caseClientAccessRoutes);
router.use('/', caseDocumentShareRoutes);
router.use('/', caseMessageRoutes);
router.use('/', caseDocumentRequestRoutes);
router.use('/', caseFinanceRoutes);

router.get('/', asyncHandler(ctrl.list));
router.post('/', cases.create, asyncHandler(ctrl.create));
router.get('/:id', cases.id, asyncHandler(ctrl.get));
router.put('/:id', cases.update, asyncHandler(ctrl.update));
router.delete('/:id', cases.id, asyncHandler(ctrl.remove));

module.exports = router;
