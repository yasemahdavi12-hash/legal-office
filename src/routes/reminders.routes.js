const express = require('express');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/validate');
const { rateLimit } = require('../middleware/rateLimit');
const pushCtrl = require('../controllers/push.controller');

const router = express.Router();
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: 'تعداد درخواست یادآوری بیش از حد مجاز است.'
});

router.use(authenticate, limiter);
router.get('/', asyncHandler(pushCtrl.listReminders));
router.get('/today', (req, res, next) => {
  req.query.scope = 'today';
  return pushCtrl.listReminders(req, res).catch(next);
});
router.get('/upcoming', (req, res, next) => {
  req.query.scope = 'upcoming';
  return pushCtrl.listReminders(req, res).catch(next);
});

module.exports = router;
