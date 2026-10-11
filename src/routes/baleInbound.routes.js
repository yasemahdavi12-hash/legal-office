const express = require('express');
const webhookCtrl = require('../controllers/baleInbound.controller');
const inboxCtrl = require('../controllers/baleInbox.controller');
const { asyncHandler } = require('../middleware/validate');
const { rateLimit } = require('../middleware/rateLimit');
const { authenticate } = require('../middleware/auth');
const { baleInbox } = require('../validators/crud');

const router = express.Router();

const webhookLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  message: 'تعداد درخواست وب‌هوک بیش از حد مجاز است'
});

const replyLimiter = rateLimit({
  windowMs: 60_000,
  max: () => Number(process.env.BALE_REPLY_RATE_MAX || 30),
  message: 'تعداد ارسال پاسخ بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.',
  keyGenerator: (req) => `bale-reply|${req.user?.id || req.ip}`
});

router.post('/webhook/:secret', webhookLimiter, asyncHandler(webhookCtrl.webhook));

router.get('/threads', authenticate, asyncHandler(inboxCtrl.threads));
router.get('/messages', authenticate, baleInbox.messagesQuery, asyncHandler(inboxCtrl.messages));
router.patch('/messages/:id/read', authenticate, baleInbox.markRead, asyncHandler(inboxCtrl.markRead));
router.post('/reply', authenticate, replyLimiter, baleInbox.reply, asyncHandler(inboxCtrl.reply));

module.exports = router;
