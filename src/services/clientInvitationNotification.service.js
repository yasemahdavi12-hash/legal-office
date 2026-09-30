const config = require('../config');
const { getSmsProvider, isSmsDeliveryConfigured } = require('./sms');
const { normalizeSmsResult } = require('./sms/SmsProviderInterface');

function buildInvitationMessage({ clientName, lawyerName, invitationUrl }) {
  const name = (clientName || 'کاربر گرامی').trim();
  const lawyer = (lawyerName || 'وکیل').trim();
  return (
    `سلام ${name}\n`
    + `شما توسط وکیل ${lawyer} برای دسترسی به پرونده خود در «قانون در جیب شما» دعوت شده‌اید.\n\n`
    + `برای ورود و مشاهده پرونده، روی لینک زیر بزنید:\n\n`
    + `${invitationUrl}\n\n`
    + `این لینک دارای اعتبار محدود است.`
  );
}

/**
 * Send client invitation link via SMS abstraction (no sensitive case details).
 * @returns {{ ok: boolean, status: string, provider?: string, reason?: string, queued?: boolean }}
 */
async function sendClientInvitation(payload) {
  const { client, lawyerName, invitationUrl } = payload || {};
  const phone = client?.phone ? String(client.phone).trim() : '';
  if (!phone) {
    return { ok: false, status: 'no_phone', reason: 'no_phone', provider: 'none' };
  }
  if (!invitationUrl) {
    return { ok: false, status: 'provider_failed', reason: 'no_url', provider: 'none' };
  }

  const sms = getSmsProvider();
  const providerLabel = typeof sms.providerId === 'function' ? sms.providerId() : 'unknown';

  if (!isSmsDeliveryConfigured()) {
    if (!config.isProd) {
      const masked = phone.replace(/\d(?=\d{4})/g, '*');
      console.info(`[dev] Client invitation SMS (not_configured) for ${masked}`);
      console.info('[dev] Invitation URL (SMS not configured):', invitationUrl);
    }
    return {
      ok: false,
      status: 'not_configured',
      reason: 'sms_not_configured',
      provider: providerLabel
    };
  }

  const message = buildInvitationMessage({
    clientName: client?.name,
    lawyerName,
    invitationUrl
  });

  const raw = normalizeSmsResult(await sms.sendInvitation({
    to: phone,
    message,
    meta: { type: 'client_invitation' }
  }));

  if (!config.isProd && raw.ok) {
    const masked = phone.replace(/\d(?=\d{4})/g, '*');
    console.info(`[dev] Client invitation SMS (sent) for ${masked}`);
  }

  return {
    ok: raw.ok,
    status: raw.ok ? 'sent' : 'provider_failed',
    provider: raw.provider,
    reason: raw.ok ? undefined : raw.reason,
    queued: !!raw.queued
  };
}

module.exports = {
  sendClientInvitation,
  buildInvitationMessage
};
