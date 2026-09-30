const express = require('express');
const ctrl = require('../controllers/communication.controller');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/validate');
const { communications } = require('../validators/crud');

const router = express.Router();
router.use(authenticate);
router.get('/', asyncHandler(ctrl.list));
router.put('/', communications.upsert, asyncHandler(ctrl.upsert));
router.post('/connect', communications.connect, asyncHandler(ctrl.connect));
router.post('/disconnect', communications.disconnect, asyncHandler(ctrl.disconnect));
router.post('/send', communications.send, asyncHandler(ctrl.send));
module.exports = router;
