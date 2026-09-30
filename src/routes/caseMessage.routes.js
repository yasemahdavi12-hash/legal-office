const express = require('express');
const ctrl = require('../controllers/caseMessage.controller');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, validate } = require('../middleware/validate');
const { rateLimit } = require('../middleware/rateLimit');

const router = express.Router({ mergeParams: true });

router.use(authenticate);

const messagePostLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 40,
  message: 'تعداد پیام‌های ارسالی بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.',
  keyGenerator: (req) => `case-msg|${req.user?.id || req.ip}|${req.params.caseId || ''}`
});

const caseIdParam = {
  caseId: { in: 'params', required: true, type: 'id' }
};

const bodySchema = {
  body: { required: true, trim: true, minLength: 1, maxLength: 5000 }
};

router.get(
  '/:caseId/messages/unread-count',
  validate(caseIdParam),
  asyncHandler(ctrl.unreadForLawyer)
);

router.post(
  '/:caseId/messages/mark-read',
  validate(caseIdParam),
  asyncHandler(ctrl.markReadLawyer)
);

router.get(
  '/:caseId/messages',
  validate(caseIdParam),
  asyncHandler(ctrl.listForLawyer)
);

router.post(
  '/:caseId/messages',
  messagePostLimiter,
  validate({ ...caseIdParam, ...bodySchema }),
  asyncHandler(ctrl.createForLawyer)
);

module.exports = router;
