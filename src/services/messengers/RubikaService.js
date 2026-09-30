const { MessengerInterface } = require('./MessengerInterface');
const { AppError } = require('../../utils/response');

/**
 * Rubika messenger adapter — interface only (no real API calls).
 */
class RubikaService extends MessengerInterface {
  constructor() {
    super('rubika');
    this.connected = false;
    this.settings = null;
  }

  async connect(settings = {}) {
    this.settings = { ...settings, token: settings.token ? '[REDACTED]' : null };
    this.connected = true;
    return {
      platform: this.platform,
      connected: true,
      message: 'اتصال روبیکا به‌صورت Interface آماده شد. ارسال واقعی هنوز فعال نیست.'
    };
  }

  async disconnect() {
    this.connected = false;
    this.settings = null;
    return { platform: this.platform, connected: false };
  }

  async sendMessage() {
    throw new AppError('ارسال واقعی پیام روبیکا هنوز پیاده‌سازی نشده است', 501);
  }

  async manageChannel() {
    throw new AppError('مدیریت کانال روبیکا هنوز پیاده‌سازی نشده است', 501);
  }

  async manageGroup() {
    throw new AppError('مدیریت گروه روبیکا هنوز پیاده‌سازی نشده است', 501);
  }
}

module.exports = { RubikaService };
