const express = require('express');
const multer = require('multer');
const path = require('path');
const os = require('os');
const ctrl = require('../controllers/portal.controller');
const docShareCtrl = require('../controllers/caseClientDocumentAccess.controller');
const caseMsgCtrl = require('../controllers/caseMessage.controller');
const docReqCtrl = require('../controllers/caseDocumentRequest.controller');
const financeCtrl = require('../controllers/caseFinance.controller');
const config = require('../config');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, validate } = require('../middleware/validate');
const { rateLimit } = require('../middleware/rateLimit');
const { requireActivePortalCaseAccess } = require('../middleware/portalCaseAccess');

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: 'تعداد تلاش بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.'
});

const portalMessageLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 40,
  message: 'تعداد پیام‌های ارسالی بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.',
  keyGenerator: (req) => `portal-msg|${req.user?.id || req.ip}|${req.params.caseId || ''}`
});

const portalUpload = multer({
  dest: path.join(os.tmpdir(), 'legal-uploads'),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024 }
});

router.post('/register', authLimiter, validate({
  name: { required: true, trim: true, minLength: 2, maxLength: 120 },
  email: { required: true, type: 'email', trim: true, maxLength: 180 },
  password: { required: true, minLength: 8, maxLength: 128 },
  phone: { required: true, trim: true, minLength: 10, maxLength: 32 }
}), asyncHandler(ctrl.register));

router.post('/login', authLimiter, validate({
  email: { required: true, type: 'email', trim: true },
  password: { required: true, minLength: 1, maxLength: 128 }
}), asyncHandler(ctrl.login));

router.get(
  '/invite/:token',
  validate({ token: { in: 'params', required: true, trim: true, minLength: 16, maxLength: 128 } }),
  asyncHandler(ctrl.getInviteStatus)
);

router.use(authenticate);

router.post(
  '/invite/:token/accept',
  validate({ token: { in: 'params', required: true, trim: true, minLength: 16, maxLength: 128 } }),
  asyncHandler(ctrl.acceptInviteByToken)
);

router.get('/cases', asyncHandler(ctrl.listCases));
router.get(
  '/cases/:caseId/documents/:documentId/download',
  validate({
    caseId: { in: 'params', required: true, type: 'id' },
    documentId: { in: 'params', required: true, type: 'id' }
  }),
  asyncHandler(requireActivePortalCaseAccess),
  asyncHandler(docShareCtrl.downloadPortalDocument)
);
router.get(
  '/cases/:caseId/documents',
  validate({ caseId: { in: 'params', required: true, type: 'id' } }),
  asyncHandler(requireActivePortalCaseAccess),
  asyncHandler(docShareCtrl.listPortalDocuments)
);
router.get(
  '/cases/:caseId/messages/unread-count',
  validate({ caseId: { in: 'params', required: true, type: 'id' } }),
  asyncHandler(requireActivePortalCaseAccess),
  asyncHandler(caseMsgCtrl.unreadForPortal)
);

router.post(
  '/cases/:caseId/messages/mark-read',
  validate({ caseId: { in: 'params', required: true, type: 'id' } }),
  asyncHandler(requireActivePortalCaseAccess),
  asyncHandler(caseMsgCtrl.markReadPortal)
);

router.get(
  '/cases/:caseId/messages',
  validate({ caseId: { in: 'params', required: true, type: 'id' } }),
  asyncHandler(requireActivePortalCaseAccess),
  asyncHandler(caseMsgCtrl.listForPortal)
);
router.post(
  '/cases/:caseId/messages',
  portalMessageLimiter,
  validate({
    caseId: { in: 'params', required: true, type: 'id' },
    body: { required: true, trim: true, minLength: 1, maxLength: 5000 }
  }),
  asyncHandler(requireActivePortalCaseAccess),
  asyncHandler(caseMsgCtrl.createForPortal)
);
router.get(
  '/cases/:caseId/document-requests',
  validate({ caseId: { in: 'params', required: true, type: 'id' } }),
  asyncHandler(requireActivePortalCaseAccess),
  asyncHandler(docReqCtrl.listPortal)
);
router.get(
  '/cases/:caseId/finance',
  validate({ caseId: { in: 'params', required: true, type: 'id' } }),
  asyncHandler(requireActivePortalCaseAccess),
  asyncHandler(financeCtrl.getPortalFinance)
);
router.get(
  '/cases/:caseId/payments',
  validate({ caseId: { in: 'params', required: true, type: 'id' } }),
  asyncHandler(requireActivePortalCaseAccess),
  asyncHandler(financeCtrl.listPortalPayments)
);
router.post(
  '/cases/:caseId/document-requests/:requestId/submit',
  portalUpload.single('file'),
  validate({
    caseId: { in: 'params', required: true, type: 'id' },
    requestId: { in: 'params', required: true, type: 'id' }
  }),
  asyncHandler(requireActivePortalCaseAccess),
  asyncHandler(docReqCtrl.submitPortal)
);
router.get(
  '/cases/:id',
  validate({ id: { in: 'params', required: true, type: 'id' } }),
  asyncHandler(requireActivePortalCaseAccess),
  asyncHandler(ctrl.getCase)
);
router.get('/client-access/pending', asyncHandler(ctrl.listPendingInvites));
router.post(
  '/client-access/:accessId/accept',
  validate({ accessId: { in: 'params', required: true, type: 'id' } }),
  asyncHandler(ctrl.acceptAccess)
);

module.exports = router;
