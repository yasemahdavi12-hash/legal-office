const db = require('../db/connection');
const { processDueReminders } = require('../services/reminder.service');
const { safeLog } = require('../utils/logger');
const config = require('../config');

let timer = null;
let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    await processDueReminders({ limit: 40 });
  } catch (err) {
    safeLog('[reminderScheduler]', err && err.message);
  } finally {
    running = false;
  }
}

function startReminderScheduler() {
  if (timer) return;
  const ms = Number(process.env.REMINDER_POLL_MS || 30000);
  // Run once shortly after boot, then on interval
  setTimeout(() => { tick(); }, 3000);
  timer = setInterval(tick, Number.isFinite(ms) && ms >= 5000 ? ms : 30000);
  if (timer.unref) timer.unref();
  if (!config.isProd) {
    // quiet in prod
  }
}

function stopReminderScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { startReminderScheduler, stopReminderScheduler, tick };
