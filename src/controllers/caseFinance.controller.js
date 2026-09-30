const service = require('../services/caseFinance.service');
const { ok } = require('../utils/response');
const { AppError } = require('../utils/response');

function blockClientMutation(user) {
  if (user?.role === 'client') {
    throw new AppError('دسترسی مجاز نیست', 403);
  }
}

async function getFinance(req, res) {
  blockClientMutation(req.user);
  const caseId = Number(req.params.caseId);
  return ok(res, await service.getFinanceForLawyer(caseId, req.user));
}

async function putFinance(req, res) {
  blockClientMutation(req.user);
  const caseId = Number(req.params.caseId);
  const agreedFee = req.body.agreedFee ?? req.body.agreed_fee;
  return ok(res, await service.upsertAgreedFee(caseId, agreedFee, req.user));
}

async function listPayments(req, res) {
  blockClientMutation(req.user);
  const caseId = Number(req.params.caseId);
  return ok(res, await service.listPaymentsForLawyer(caseId, req.user));
}

async function createPayment(req, res) {
  blockClientMutation(req.user);
  const caseId = Number(req.params.caseId);
  const data = await service.recordPayment(caseId, req.body, req.user);
  return ok(res, data, 201);
}

async function cancelPayment(req, res) {
  blockClientMutation(req.user);
  const caseId = Number(req.params.caseId);
  const paymentId = Number(req.params.paymentId);
  return ok(res, await service.cancelPayment(caseId, paymentId, req.user));
}

async function getPortalFinance(req, res) {
  const caseId = Number(req.params.caseId);
  return ok(res, await service.getFinanceForClient(caseId, req.user));
}

async function listPortalPayments(req, res) {
  const caseId = Number(req.params.caseId);
  return ok(res, await service.listPaymentsForClient(caseId, req.user));
}

module.exports = {
  getFinance,
  putFinance,
  listPayments,
  createPayment,
  cancelPayment,
  getPortalFinance,
  listPortalPayments
};
