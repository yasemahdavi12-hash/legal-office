const express = require('express');
const ctrl = require('../controllers/subscription.controller');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/validate');
const { rateLimit } = require('../middleware/rateLimit');

const router = express.Router();

const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'تعداد درخواست پرداخت بیش از حد مجاز است.'
});

// ZarinPal redirects here — must be public (no JWT)
router.get('/callback', asyncHandler(ctrl.callback));

router.use(authenticate);

router.get('/', asyncHandler(ctrl.getMine));
router.get('/me', asyncHandler(ctrl.getMine));
router.post('/checkout', checkoutLimiter, asyncHandler(ctrl.checkout));

module.exports = router;
