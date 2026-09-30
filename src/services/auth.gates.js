/**
 * Admin MFA login gates (shared by auth.service + tests).
 */
function adminLoginGate(user, {
  isProd,
  signMfaSetupToken,
  signMfaChallenge
}) {
  if (!user || user.role !== 'admin') return null;

  if (!user.mfa_enabled && isProd) {
    return {
      mfaSetupRequired: true,
      setupToken: signMfaSetupToken(user),
      user: { id: user.id, email: user.email, role: user.role }
    };
  }

  if (user.mfa_enabled) {
    return {
      mfaRequired: true,
      mfaToken: signMfaChallenge(user),
      user: { id: user.id, email: user.email, role: user.role }
    };
  }

  return null;
}

module.exports = { adminLoginGate };
