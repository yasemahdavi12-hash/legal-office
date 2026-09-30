/**
 * Timezone helpers for event wall-clock → UTC fire_at.
 * Asia/Tehran is fixed UTC+03:30 (no DST since 2022).
 * Also supports UTC and explicit ±HH:MM / ±HHMM offsets.
 */

const NAMED_OFFSETS = {
  UTC: 0,
  GMT: 0,
  'Asia/Tehran': 210,
  'Asia/Dubai': 240,
  'Europe/London': 0
};

function resolveOffsetMinutes(timezone) {
  const tz = String(timezone || 'Asia/Tehran').trim();
  if (NAMED_OFFSETS[tz] != null) return NAMED_OFFSETS[tz];
  const m = tz.match(/^([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (m) {
    const sign = m[1] === '-' ? -1 : 1;
    const h = Number(m[2]);
    const min = Number(m[3] || 0);
    return sign * (h * 60 + min);
  }
  // Safe default for this product
  return NAMED_OFFSETS['Asia/Tehran'];
}

/**
 * Convert local date+time in timezone to UTC Date.
 * @param {string} dateStr YYYY-MM-DD
 * @param {string|null} timeStr HH:mm or HH:mm:ss
 * @param {string} timezone
 */
function localDateTimeToUtc(dateStr, timeStr, timezone) {
  const date = String(dateStr || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('invalid date');
  }
  const time = String(timeStr || '00:00').trim();
  const tm = time.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  const hh = tm ? Number(tm[1]) : 0;
  const mm = tm ? Number(tm[2]) : 0;
  const ss = tm && tm[3] ? Number(tm[3]) : 0;
  const [y, mo, d] = date.split('-').map(Number);
  const offsetMin = resolveOffsetMinutes(timezone);
  const asUtcMs = Date.UTC(y, mo - 1, d, hh, mm, ss) - offsetMin * 60 * 1000;
  return new Date(asUtcMs);
}

function computeFireAtUtc(dateStr, timeStr, timezone, offsetMinutes) {
  const eventUtc = localDateTimeToUtc(dateStr, timeStr, timezone);
  return new Date(eventUtc.getTime() - Number(offsetMinutes) * 60 * 1000);
}

/** Local calendar date YYYY-MM-DD for "today" in timezone */
function localToday(timezone, now = new Date()) {
  const offsetMin = resolveOffsetMinutes(timezone);
  const local = new Date(now.getTime() + offsetMin * 60 * 1000);
  const y = local.getUTCFullYear();
  const m = String(local.getUTCMonth() + 1).padStart(2, '0');
  const d = String(local.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

module.exports = {
  resolveOffsetMinutes,
  localDateTimeToUtc,
  computeFireAtUtc,
  localToday,
  DEFAULT_TIMEZONE: 'Asia/Tehran'
};
