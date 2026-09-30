const { AppError } = require('../utils/response');
const { assertClientActiveCaseAccess } = require('../services/caseClientAccess.service');

function requireClientRole(user) {
  if (!user || user.role !== 'client') {
    throw new AppError('دسترسی مجاز نیست', 403);
  }
}

/**
 * Ensures authenticated client has active case_client_access for req.params.caseId (or :id).
 */
async function requireActivePortalCaseAccess(req, res, next) {
  try {
    requireClientRole(req.user);
    const raw = req.params.caseId ?? req.params.id;
    const caseId = Number(raw);
    const ctx = await assertClientActiveCaseAccess(caseId, req.user);
    req.portalCaseAccess = ctx.access;
    req.portalCase = ctx.caseRow;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireClientRole, requireActivePortalCaseAccess };
