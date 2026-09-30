const express = require('express');
const ctrl = require('../controllers/caseClientAccess.controller');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, validate } = require('../middleware/validate');

const router = express.Router({ mergeParams: true });

router.use(authenticate);

const caseIdParam = {
  caseId: { in: 'params', required: true, type: 'id' }
};

router.post(
  '/:caseId/client-access/invite',
  validate({
    ...caseIdParam,
    clientId: { type: 'id' },
    client_id: { type: 'id' }
  }, { requireAny: [['clientId', 'client_id']] }),
  asyncHandler(ctrl.invite)
);

router.get(
  '/:caseId/client-access',
  validate(caseIdParam),
  asyncHandler(ctrl.list)
);

router.delete(
  '/:caseId/client-access/:accessId',
  validate({
    ...caseIdParam,
    accessId: { in: 'params', required: true, type: 'id' }
  }),
  asyncHandler(ctrl.revoke)
);

module.exports = router;
