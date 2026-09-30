const express = require('express');
const ctrl = require('../controllers/note.controller');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/validate');
const { notes } = require('../validators/crud');

const router = express.Router();
router.use(authenticate);
router.get('/', asyncHandler(ctrl.list));
router.post('/', notes.create, asyncHandler(ctrl.create));
router.get('/:id', notes.id, asyncHandler(ctrl.get));
router.put('/:id', notes.update, asyncHandler(ctrl.update));
router.delete('/:id', notes.id, asyncHandler(ctrl.remove));
module.exports = router;
