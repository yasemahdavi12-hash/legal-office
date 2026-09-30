const express = require('express');
const ctrl = require('../controllers/push.controller');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, validate } = require('../middleware/validate');
const { rateLimit } = require('../middleware/rateLimit');

const router = express.Router();

const pushLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  message: 'تعداد درخواست Push بیش از حد مجاز است.'
});

router.get('/vapid-public-key', pushLimiter, asyncHandler(ctrl.vapidPublicKey));

router.use(authenticate);

router.get('/subscriptions', pushLimiter, asyncHandler(ctrl.listSubscriptions));
router.post('/subscribe', pushLimiter, validate({
  // Must fit MySQL UNIQUE varchar(768) utf8mb4 index limit
  endpoint: { required: true, trim: true, maxLength: 768 }
}), asyncHandler(ctrl.subscribe));
router.delete('/subscribe', pushLimiter, validate({
  endpoint: { required: true, trim: true, maxLength: 768 }
}), asyncHandler(ctrl.unsubscribe));
router.post('/unsubscribe', pushLimiter, validate({
  endpoint: { required: true, trim: true, maxLength: 768 }
}), asyncHandler(ctrl.unsubscribe));

router.get('/reminders', pushLimiter, asyncHandler(ctrl.listReminders));

module.exports = router;
