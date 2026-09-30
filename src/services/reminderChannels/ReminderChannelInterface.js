/** Reminder delivery channel contract — independent of reminder scheduling. */
class ReminderChannelInterface {
  /** @returns {string} */
  get name() {
    throw new Error('name getter required');
  }

  /** Whether this channel should be attempted for deliveries. */
  isEnabled() {
    return false;
  }

  /**
   * @param {number} _userId
   * @returns {Promise<boolean>}
   */
  async canDeliver(_userId) {
    return false;
  }

  /**
   * @param {{ userId: number, reminder: object, event: object, title: string, body: string, data?: object }} _payload
   * @returns {Promise<{ ok: boolean, skipped?: boolean, error?: string }>}
   */
  async deliver(_payload) {
    throw new Error('deliver() must be implemented');
  }
}

/** Placeholder for future SMS / Bale / Rubika adapters. */
class StubReminderChannel extends ReminderChannelInterface {
  constructor(channelName) {
    super();
    this._name = channelName;
  }

  get name() {
    return this._name;
  }

  isEnabled() {
    return false;
  }

  async canDeliver() {
    return false;
  }

  async deliver() {
    return { ok: false, skipped: true, error: 'channel_not_configured' };
  }
}

module.exports = { ReminderChannelInterface, StubReminderChannel };
