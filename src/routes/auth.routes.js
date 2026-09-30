const express = require('express');
const ctrl = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth');
const { validate, asyncHandler } = require('../middleware/validate');
const { rateLimit } = require('../middleware/rateLimit');

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: 'تعداد تلاش ورود بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.'
});

const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: 'تعداد درخواست تمدید نشست بیش از حد مجاز است.'
});

router.post('/login', authLimiter, validate({
  email: { required: true, type: 'email', trim: true },
  password: { required: true, minLength: 1, maxLength: 128 }
}), asyncHandler(ctrl.login));

router.post('/register', authLimiter, validate({
  name: { required: true, trim: true, minLength: 2, maxLength: 120 },
  email: { required: true, type: 'email', trim: true, maxLength: 180 },
  password: { required: true, minLength: 8, maxLength: 128 },
  role: { trim: true, enum: ['lawyer'] }
}), asyncHandler(ctrl.register));

router.post('/refresh', refreshLimiter, validate(
  {
    refreshToken: { trim: true },
    refresh_token: { trim: true }
  },
  { requireAny: [['refreshToken', 'refresh_token']] }
), asyncHandler(ctrl.refresh));

router.post('/logout', asyncHandler(ctrl.logout));

router.get('/me', authenticate, asyncHandler(ctrl.me));
router.patch('/me', authenticate, validate({
  name: { trim: true, minLength: 2, maxLength: 120 },
  phone: { trim: true, maxLength: 32 },
  license_number: { trim: true, maxLength: 64 },
  licenseNumber: { trim: true, maxLength: 64 }
}), asyncHandler(ctrl.updateMe));
router.put('/me', authenticate, validate({
  name: { trim: true, minLength: 2, maxLength: 120 },
  phone: { trim: true, maxLength: 32 },
  license_number: { trim: true, maxLength: 64 },
  licenseNumber: { trim: true, maxLength: 64 }
}), asyncHandler(ctrl.updateMe));

router.post('/change-password', authenticate, authLimiter, validate(
  {
    currentPassword: { minLength: 1, maxLength: 128 },
    current_password: { minLength: 1, maxLength: 128 },
    newPassword: { minLength: 8, maxLength: 128 },
    new_password: { minLength: 8, maxLength: 128 },
    password: { minLength: 8, maxLength: 128 }
  },
  { requireAny: [['currentPassword', 'current_password'], ['newPassword', 'new_password', 'password']] }
), asyncHandler(ctrl.changePassword));

module.exports = router;
