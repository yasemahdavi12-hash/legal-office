const { MessengerInterface } = require('./MessengerInterface');
const { AppError } = require('../../utils/response');

/**
 * Bale messenger adapter — interface only (no real API calls).
 */
class BaleService extends MessengerInterface {
  constructor() {
    super('bale');
    this.connected = false;
    this.settings = null;
  }

  async connect(settings = {}) {
    this.settings = { ...settings, token: settings.token ? '[REDACTED]' : null };
    this.connected = true;
    return {
      platform: this.platform,
      connected: true,
      message: 'اتصال بله به‌صورت Interface آماده شد. ارسال واقعی هنوز فعال نیست.'
    };
  }

  async disconnect() {
    this.connected = false;
    this.settings = null;
    return { platform: this.platform, connected: false };
  }

  async sendMessage() {
    throw new AppError('ارسال واقعی پیام بله هنوز پیاده‌سازی نشده است', 501);
  }

  async manageChannel() {
    throw new AppError('مدیریت کانال بله هنوز پیاده‌سازی نشده است', 501);
  }

  async manageGroup() {
    throw new AppError('مدیریت گروه بله هنوز پیاده‌سازی نشده است', 501);
  }
}

module.exports = { BaleService };
