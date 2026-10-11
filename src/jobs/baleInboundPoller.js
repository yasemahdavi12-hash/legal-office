const config = require('../config');
const { pollBaleInboundOnce } = require('../services/baleInbound.service');
const { safeLog } = require('../utils/logger');

let timer = null;
let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    await pollBaleInboundOnce();
  } catch (err) {
    safeLog('[baleInboundPoller]', err && err.message);
  } finally {
    running = false;
  }
}

function startBaleInboundPoller() {
  if (!config.bale.inboundPolling) return;
  if (timer) return;
  const ms = config.bale.pollIntervalMs;
  setTimeout(() => { tick(); }, 5000);
  timer = setInterval(tick, Number.isFinite(ms) && ms >= 10_000 ? ms : 20_000);
  if (timer.unref) timer.unref();
}

function stopBaleInboundPoller() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { startBaleInboundPoller, stopBaleInboundPoller, tick };
