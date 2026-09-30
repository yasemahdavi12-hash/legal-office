const subscriptionService = require('../services/subscription.service');
const paymentService = require('../services/payment.service');
const { ok } = require('../utils/response');

async function getMine(req, res) {
  const data = await subscriptionService.getSubscriptionStatus(req.user);
  return ok(res, data);
}

async function checkout(req, res) {
  const data = await paymentService.checkout(req.user, req.body || {});
  return ok(res, data);
}

async function callback(req, res) {
  const authority = req.query.Authority || req.query.authority;
  const status = req.query.Status || req.query.status;
  const result = await paymentService.handleCallback({ authority, status });
  return res.redirect(302, result.redirectUrl);
}

module.exports = { getMine, checkout, callback };
