const express = require('express');
const ctrl = require('../controllers/mfa.controller');
const { authenticateMfaAdmin } = require('../middleware/auth');
const { validate, asyncHandler } = require('../middleware/validate');
const { rateLimit } = require('../middleware/rateLimit');

const router = express.Router();

const mfaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'تعداد تلاش MFA بیش از حد مجاز است.'
});

router.post('/verify', mfaLimiter, validate({
  mfaToken: { required: true, trim: true, maxLength: 2000 },
  code: { required: true, trim: true, minLength: 6, maxLength: 32 }
}), asyncHandler(ctrl.verify));

// Admin MFA management — access token OR production setupToken
router.use(authenticateMfaAdmin);

router.get('/status', asyncHandler(ctrl.status));
router.post('/setup', mfaLimiter, asyncHandler(ctrl.setup));
router.post('/enable', mfaLimiter, validate({
  code: { required: true, trim: true, minLength: 6, maxLength: 16 }
}), asyncHandler(ctrl.enable));
router.post('/disable', mfaLimiter, validate({
  password: { required: true, minLength: 1, maxLength: 128 },
  code: { required: true, trim: true, minLength: 6, maxLength: 32 }
}), asyncHandler(ctrl.disable));

module.exports = router;
