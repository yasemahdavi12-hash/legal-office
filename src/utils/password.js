const bcrypt = require('bcryptjs');

async function hashPassword(plain) {
  return bcrypt.hash(String(plain), 12);
}

async function comparePassword(plain, hash) {
  return bcrypt.compare(String(plain), String(hash));
}

module.exports = { hashPassword, comparePassword };
