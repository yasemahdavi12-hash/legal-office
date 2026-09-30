const express = require('express');
const ctrl = require('../controllers/ai.controller');
const aiService = require('../services/ai.service');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, validate } = require('../middleware/validate');
const { rateLimit } = require('../middleware/rateLimit');

const router = express.Router();

router.use(authenticate);

router.get('/status', asyncHandler(ctrl.status));

/** Reject FREE / expired PRO before rate-limit or provider call. */
async function requireProForAi(req, _res, next) {
  try {
    await aiService.assertProForAi(req.user);
    next();
  } catch (err) {
    next(err);
  }
}

const aiDailyLimit = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: Number(process.env.AI_DAILY_LIMIT_PRO) || 50,
  message: 'سقف روزانه درخواست دستیار هوشمند به پایان رسیده است.',
  keyGenerator: (req) => `ai:chat:${req.user.id}`
});

router.post(
  '/chat',
  requireProForAi,
  aiDailyLimit,
  validate({
    message: { required: true, trim: true, minLength: 1, maxLength: 4000 },
    caseId: { type: 'int', in: 'body' },
    case_id: { type: 'int', in: 'body' }
  }),
  asyncHandler(ctrl.chat)
);

module.exports = router;
