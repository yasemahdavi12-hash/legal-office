const { validate } = require('../middleware/validate');

const ADMIN_ROLES = ['admin', 'lawyer'];
const idParam = { id: { in: 'params', required: true, type: 'id' } };

const adminUsers = {
  create: validate({
    name: { required: true, trim: true, minLength: 2, maxLength: 120 },
    email: { required: true, type: 'email', trim: true, maxLength: 180 },
    password: { required: true, minLength: 8, maxLength: 128 },
    phone: { trim: true, maxLength: 32 },
    role: { required: true, enum: ADMIN_ROLES }
  }),
  update: validate({
    ...idParam,
    name: { trim: true, minLength: 2, maxLength: 120 },
    email: { type: 'email', trim: true, maxLength: 180 },
    password: { minLength: 8, maxLength: 128 },
    phone: { trim: true, maxLength: 32 },
    role: { enum: ADMIN_ROLES }
  }),
  role: validate({
    ...idParam,
    role: { required: true, enum: ADMIN_ROLES }
  }),
  id: validate(idParam),
  subscription: validate({
    ...idParam,
    plan: { required: true, enum: ['free', 'pro'] },
    expiresAt: { trim: true, maxLength: 40 },
    expires_at: { trim: true, maxLength: 40 },
    subscription_expires_at: { trim: true, maxLength: 40 },
    note: { trim: true, maxLength: 255 }
  })
};

module.exports = { adminUsers, ADMIN_ROLES };
