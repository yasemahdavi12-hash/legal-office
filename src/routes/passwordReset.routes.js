const express = require('express');
const ctrl = require('../controllers/passwordReset.controller');
const { validate, asyncHandler } = require('../middleware/validate');
const { rateLimit } = require('../middleware/rateLimit');

const router = express.Router();

const forgotLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  message: 'تعداد درخواست بازیابی رمز بیش از حد مجاز است.'
});

const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'تعداد تلاش تأیید کد بیش از حد مجاز است.'
});

const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'تعداد تلاش تنظیم رمز بیش از حد مجاز است.'
});

router.post('/forgot-password', forgotLimiter, validate(
  {
    identifier: { trim: true, maxLength: 180 },
    email: { trim: true, maxLength: 180 },
    phone: { trim: true, maxLength: 32 }
  },
  { requireAny: [['identifier', 'email', 'phone']] }
), asyncHandler(ctrl.forgotPassword));

router.post('/verify-otp', verifyLimiter, validate(
  {
    identifier: { trim: true, maxLength: 180 },
    email: { trim: true, maxLength: 180 },
    phone: { trim: true, maxLength: 32 },
    otp: { trim: true, maxLength: 6 },
    code: { trim: true, maxLength: 6 }
  },
  { requireAny: [['identifier', 'email', 'phone'], ['otp', 'code']] }
), asyncHandler(ctrl.verifyOtp));

router.post('/reset-password', resetLimiter, validate(
  {
    resetToken: { trim: true, maxLength: 128 },
    reset_token: { trim: true, maxLength: 128 },
    password: { minLength: 8, maxLength: 128 },
    newPassword: { minLength: 8, maxLength: 128 },
    new_password: { minLength: 8, maxLength: 128 }
  },
  { requireAny: [['resetToken', 'reset_token'], ['password', 'newPassword', 'new_password']] }
), asyncHandler(ctrl.resetPassword));

module.exports = router;
