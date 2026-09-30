const express = require('express');
const ctrl = require('../controllers/caseFinance.controller');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, validate } = require('../middleware/validate');

const router = express.Router();

router.use(authenticate);

const caseIdParam = {
  caseId: { in: 'params', required: true, type: 'id' }
};

router.get(
  '/:caseId/finance',
  validate(caseIdParam),
  asyncHandler(ctrl.getFinance)
);

router.put(
  '/:caseId/finance',
  validate({
    ...caseIdParam,
    agreedFee: { type: 'number' },
    agreed_fee: { type: 'number' }
  }, { requireAny: [['agreedFee', 'agreed_fee']] }),
  asyncHandler(ctrl.putFinance)
);

router.get(
  '/:caseId/payments',
  validate(caseIdParam),
  asyncHandler(ctrl.listPayments)
);

router.post(
  '/:caseId/payments',
  validate({
    ...caseIdParam,
    amount: { required: true, type: 'number' },
    paymentDate: { trim: true, maxLength: 32 },
    payment_date: { trim: true, maxLength: 32 },
    description: { trim: true, maxLength: 500 }
  }, { requireAny: [['paymentDate', 'payment_date']] }),
  asyncHandler(ctrl.createPayment)
);

router.post(
  '/:caseId/payments/:paymentId/cancel',
  validate({
    ...caseIdParam,
    paymentId: { in: 'params', required: true, type: 'id' }
  }),
  asyncHandler(ctrl.cancelPayment)
);

module.exports = router;
