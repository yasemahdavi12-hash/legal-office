const express = require('express');
const ctrl = require('../controllers/client.controller');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/validate');
const { clients } = require('../validators/crud');

const router = express.Router();
router.use(authenticate);
router.get('/', asyncHandler(ctrl.list));
router.post('/', clients.create, asyncHandler(ctrl.create));
router.get('/:id', clients.id, asyncHandler(ctrl.get));
router.put('/:id', clients.update, asyncHandler(ctrl.update));
router.delete('/:id', clients.id, asyncHandler(ctrl.remove));
module.exports = router;
