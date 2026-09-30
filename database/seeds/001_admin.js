const bcrypt = require('bcryptjs');

const WEAK_PASSWORDS = new Set([
  'admin123', 'password', '12345678', '123456789', 'qwerty123', 'adminadmin'
]);

exports.seed = async function seed(knex) {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME || 'مدیر سیستم';
  const isProd = (process.env.NODE_ENV || 'development') === 'production';

  if (!email || !password) {
    throw new Error('[seed] ADMIN_EMAIL and ADMIN_PASSWORD must be set in environment');
  }
  if (String(password).length < 8) {
    throw new Error('[seed] ADMIN_PASSWORD must be at least 8 characters');
  }
  if (isProd && WEAK_PASSWORDS.has(String(password))) {
    throw new Error('[seed] Weak ADMIN_PASSWORD is not allowed in production');
  }

  const existing = await knex('users').where({ email }).first();
  if (existing) return;

  const mustChange = isProd || WEAK_PASSWORDS.has(String(password));

  await knex('users').insert({
    name,
    email,
    phone: null,
    password_hash: await bcrypt.hash(password, 12),
    role: 'admin',
    token_version: 0,
    must_change_password: mustChange,
    created_at: knex.fn.now()
  });
};
