const express = require('express');
const ctrl = require('../controllers/task.controller');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/validate');
const { tasks } = require('../validators/crud');

const router = express.Router();
router.use(authenticate);
router.get('/', asyncHandler(ctrl.list));
router.post('/', tasks.create, asyncHandler(ctrl.create));
router.get('/:id', tasks.id, asyncHandler(ctrl.get));
router.put('/:id', tasks.update, asyncHandler(ctrl.update));
router.delete('/:id', tasks.id, asyncHandler(ctrl.remove));
module.exports = router;
