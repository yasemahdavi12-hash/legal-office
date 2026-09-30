/**
 * Messenger Interface — contract for Bale / Rubika integrations.
 * Real network sending is intentionally NOT implemented yet.
 */
class MessengerInterface {
  constructor(platform) {
    this.platform = platform;
  }

  async connect(_settings) {
    throw new Error('connect() must be implemented');
  }

  async disconnect() {
    throw new Error('disconnect() must be implemented');
  }

  async sendMessage(_payload) {
    throw new Error('sendMessage() must be implemented');
  }

  async manageChannel(_payload) {
    throw new Error('manageChannel() must be implemented');
  }

  async manageGroup(_payload) {
    throw new Error('manageGroup() must be implemented');
  }
}

module.exports = { MessengerInterface };
