const express = require('express');
const ctrl = require('../controllers/admin.controller');
const { authenticate, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/validate');
const { adminUsers } = require('../validators/admin');

const router = express.Router();
router.use(authenticate, requireRole('admin'));

router.get('/dashboard', asyncHandler(ctrl.dashboard));
router.get('/users', asyncHandler(ctrl.listUsers));
router.post('/users', adminUsers.create, asyncHandler(ctrl.createUser));
router.put('/users/:id', adminUsers.update, asyncHandler(ctrl.updateUser));
router.patch('/users/:id/role', adminUsers.role, asyncHandler(ctrl.updateUser));
router.put('/users/:id/subscription', adminUsers.subscription, asyncHandler(ctrl.setUserSubscription));
router.patch('/users/:id/subscription', adminUsers.subscription, asyncHandler(ctrl.setUserSubscription));
router.delete('/users/:id', adminUsers.id, asyncHandler(ctrl.deleteUser));
router.get('/audit-logs', asyncHandler(ctrl.auditLogs));

module.exports = router;
