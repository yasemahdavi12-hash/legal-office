const express = require('express');
const multer = require('multer');
const path = require('path');
const os = require('os');
const ctrl = require('../controllers/document.controller');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/validate');
const { documents } = require('../validators/crud');
const config = require('../config');

const upload = multer({
  dest: path.join(os.tmpdir(), 'legal-uploads'),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024 }
});

const router = express.Router();
router.use(authenticate);
router.get('/', asyncHandler(ctrl.list));
router.post('/', upload.single('file'), documents.create, asyncHandler(ctrl.create));
router.get('/:id', documents.id, asyncHandler(ctrl.get));
router.get('/:id/download', documents.id, asyncHandler(ctrl.download));
router.delete('/:id', documents.id, asyncHandler(ctrl.remove));
module.exports = router;
