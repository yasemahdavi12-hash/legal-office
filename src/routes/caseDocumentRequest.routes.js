const express = require('express');
const ctrl = require('../controllers/caseDocumentRequest.controller');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, validate } = require('../middleware/validate');

const router = express.Router({ mergeParams: true });

router.use(authenticate);

const caseIdParam = {
  caseId: { in: 'params', required: true, type: 'id' }
};

router.post(
  '/:caseId/document-requests',
  validate({
    ...caseIdParam,
    title: { required: true, trim: true, minLength: 1, maxLength: 200 },
    description: { trim: true, maxLength: 2000 },
    clientId: { type: 'id' },
    client_id: { type: 'id' }
  }, { requireAny: [['clientId', 'client_id']] }),
  asyncHandler(ctrl.create)
);

router.get(
  '/:caseId/document-requests',
  validate(caseIdParam),
  asyncHandler(ctrl.listLawyer)
);

router.post(
  '/:caseId/document-requests/:requestId/approve',
  validate({
    ...caseIdParam,
    requestId: { in: 'params', required: true, type: 'id' }
  }),
  asyncHandler(ctrl.approve)
);

router.post(
  '/:caseId/document-requests/:requestId/reject',
  validate({
    ...caseIdParam,
    requestId: { in: 'params', required: true, type: 'id' },
    rejectionReason: { trim: true, minLength: 1, maxLength: 2000 },
    rejection_reason: { trim: true, minLength: 1, maxLength: 2000 },
    reason: { trim: true, minLength: 1, maxLength: 2000 }
  }, { requireAny: [['rejectionReason', 'rejection_reason', 'reason']] }),
  asyncHandler(ctrl.reject)
);

router.post(
  '/:caseId/document-requests/:requestId/cancel',
  validate({
    ...caseIdParam,
    requestId: { in: 'params', required: true, type: 'id' }
  }),
  asyncHandler(ctrl.cancel)
);

module.exports = router;
