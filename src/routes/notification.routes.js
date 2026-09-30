const express = require('express');
const ctrl = require('../controllers/notification.controller');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, validate } = require('../middleware/validate');
const { rateLimit } = require('../middleware/rateLimit');

const router = express.Router();

router.use(authenticate);

const mutationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: 'تعداد درخواست‌های اعلان بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.',
  keyGenerator: (req) => `notif-mut|${req.user?.id || req.ip}`
});

const idParam = {
  notificationId: { in: 'params', required: true, type: 'id' }
};

router.get('/', asyncHandler(ctrl.list));
router.get('/unread-count', asyncHandler(ctrl.unreadCount));
router.post(
  '/read-all',
  mutationLimiter,
  asyncHandler(ctrl.markAllRead)
);
router.post(
  '/:notificationId/read',
  mutationLimiter,
  validate(idParam),
  asyncHandler(ctrl.markRead)
);
router.delete(
  '/:notificationId',
  mutationLimiter,
  validate(idParam),
  asyncHandler(ctrl.remove)
);

module.exports = router;
