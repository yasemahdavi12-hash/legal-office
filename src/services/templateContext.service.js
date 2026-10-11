const db = require('../db/connection');
const { AppError } = require('../utils/response');
const { assertCaseAccess } = require('./case.service');

async function buildVariableContext(user, caseId, overrides = {}) {
  const values = {
    lawyer_name: user.name || '',
    lawyer_phone: user.phone || '',
    document_date: new Date().toLocaleDateString('fa-IR'),
    contract_date: '',
    client_name: '',
    client_national_id: '',
    client_address: '',
    case_number: '',
    court_name: '',
    opponent_name: '',
    claim_amount: ''
  };

  if (caseId) {
    await assertCaseAccess(caseId, user);
    const c = await db('cases').where({ id: caseId }).first();
    if (c) {
      values.case_number = c.case_number || c.title || String(c.id);
      if (c.branch) values.court_name = c.branch;
      if (c.description && !values.opponent_name) {
        /* no structured opponent — leave for manual override */
      }
    }
    const client = await db('clients').where({ case_id: caseId, owner_id: user.id }).orderBy('id', 'asc').first();
    if (client) {
      values.client_name = client.name || '';
      values.client_national_id = client.national_id || '';
      values.client_address = client.description || '';
    }
  }

  if (overrides && typeof overrides === 'object') {
    for (const [k, v] of Object.entries(overrides)) {
      const key = String(k).toLowerCase();
      if (Object.prototype.hasOwnProperty.call(values, key) && v != null) {
        values[key] = String(v);
      }
    }
  }

  return values;
}

async function resolvePreviewInput(user, body) {
  const caseId = body.case_id ?? body.caseId ?? null;
  const overrides = body.variables || body.overrides || {};
  if (caseId) {
    const n = Number(caseId);
    if (!Number.isFinite(n)) throw new AppError('شناسه پرونده نامعتبر است', 400);
    return buildVariableContext(user, n, overrides);
  }
  return buildVariableContext(user, null, overrides);
}

module.exports = { buildVariableContext, resolvePreviewInput };
