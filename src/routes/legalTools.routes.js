const express = require('express');
const ctrl = require('../controllers/legalTools.controller');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/validate');

const router = express.Router();

router.use(authenticate);

router.get('/', asyncHandler(ctrl.list));
router.get('/:slug', asyncHandler(ctrl.detail));
router.post('/:slug/calculate', asyncHandler(ctrl.calculate));

module.exports = router;
