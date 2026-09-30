const { PushReminderChannel } = require('./PushReminderChannel');
const { StubReminderChannel } = require('./ReminderChannelInterface');

const registry = new Map();

function registerDefaults() {
  if (registry.size) return;
  registry.set('push', new PushReminderChannel());
  // Future adapters — registered but disabled until configured
  registry.set('sms', new StubReminderChannel('sms'));
  registry.set('bale', new StubReminderChannel('bale'));
  registry.set('rubika', new StubReminderChannel('rubika'));
}

function getReminderChannels() {
  registerDefaults();
  return Array.from(registry.values());
}

function getEnabledChannels() {
  return getReminderChannels().filter((c) => c.isEnabled());
}

function getChannel(name) {
  registerDefaults();
  return registry.get(name) || null;
}

/** Test/extension hook */
function setReminderChannel(name, channel) {
  registerDefaults();
  if (!channel) registry.delete(name);
  else registry.set(name, channel);
}

module.exports = {
  getReminderChannels,
  getEnabledChannels,
  getChannel,
  setReminderChannel
};
