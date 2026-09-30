const express = require('express');
const ctrl = require('../controllers/caseClientDocumentAccess.controller');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, validate } = require('../middleware/validate');

const router = express.Router({ mergeParams: true });

router.use(authenticate);

const caseIdParam = {
  caseId: { in: 'params', required: true, type: 'id' }
};

router.get(
  '/:caseId/documents/shared-with-client',
  validate(caseIdParam),
  asyncHandler(ctrl.listShared)
);

router.post(
  '/:caseId/documents/:documentId/share-client',
  validate({
    ...caseIdParam,
    documentId: { in: 'params', required: true, type: 'id' },
    clientId: { type: 'id' },
    client_id: { type: 'id' }
  }, { requireAny: [['clientId', 'client_id']] }),
  asyncHandler(ctrl.share)
);

router.delete(
  '/:caseId/documents/:documentId/share-client/:clientId',
  validate({
    ...caseIdParam,
    documentId: { in: 'params', required: true, type: 'id' },
    clientId: { in: 'params', required: true, type: 'id' }
  }),
  asyncHandler(ctrl.revoke)
);

module.exports = router;
