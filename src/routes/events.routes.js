const express = require('express');
const ctrl = require('../controllers/event.controller');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/validate');
const { events } = require('../validators/crud');

const router = express.Router();
router.use(authenticate);
router.get('/', asyncHandler(ctrl.list));
router.post('/', events.create, asyncHandler(ctrl.create));
router.get('/:id', events.id, asyncHandler(ctrl.get));
router.put('/:id', events.update, asyncHandler(ctrl.update));
router.delete('/:id', events.id, asyncHandler(ctrl.remove));
module.exports = router;
