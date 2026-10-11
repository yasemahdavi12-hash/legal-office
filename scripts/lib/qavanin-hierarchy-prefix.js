/**
 * Structural sortKey prefixes from qavanin section hierarchy (باب / فصل).
 * Commerce-only in batch; not IPC K-prefix.
 */
const { htmlToPlainText } = require('./qavanin-border-parser');

const PERSIAN_ORDINAL_TO_N = Object.freeze({
  اول: 1,
  دوم: 2,
  سوم: 3,
  چهارم: 4,
  پنجم: 5,
  ششم: 6,
  هفتم: 7,
  هشتم: 8,
  نهم: 9,
  دهم: 10
});

const RE_BAB = /^باب\s+(اول|دوم|سوم|چهارم|پنجم|ششم|هفتم|هشتم|نهم|دهم|\d+|[\u06F0-\u06F9]+)/u;
const RE_FASL =
  /^فصل\s+(?:اول|دوم|سوم|چهارم|پنجم|ششم|هفتم|هشتم|نهم|دهم|\d+|[\u06F0-\u06F9]+|\S+)/u;

function linesFromHtmlOrText(htmlOrText) {
  const text = htmlOrText.includes('<')
    ? htmlToPlainText(htmlOrText)
    : String(htmlOrText);
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/\u0640/g, '').trim())
    .filter((l) => l.length > 0);
}

function ordinalTokenToIndex(token) {
  if (PERSIAN_ORDINAL_TO_N[token]) return PERSIAN_ORDINAL_TO_N[token];
  const digits = String(token).replace(/[\u06F0-\u06F9]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0x06f0 + 48)
  );
  const n = Number(digits);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function extractBabFaslMarkers(htmlOrText) {
  const lines = linesFromHtmlOrText(htmlOrText);
  const markers = [];
  let babIndex = 0;
  let faslIndex = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const bm = line.match(RE_BAB);
    if (bm) {
      const idx = ordinalTokenToIndex(bm[1]);
      if (idx != null) {
        babIndex = idx;
        faslIndex = 0;
        markers.push({
          type: 'bab',
          lineIndex: i + 1,
          babIndex,
          faslIndex: 0,
          header: line.slice(0, 120)
        });
      }
      continue;
    }
    if (RE_FASL.test(line)) {
      faslIndex += 1;
      markers.push({
        type: 'fasl',
        lineIndex: i + 1,
        babIndex: babIndex || 1,
        faslIndex,
        header: line.slice(0, 120)
      });
    }
  }
  return { markers, lineCount: lines.length };
}

function hierarchyAtLine(markers, lineIndex) {
  let bab = 1;
  let fasl = 0;
  for (const m of markers) {
    if (m.lineIndex <= lineIndex) {
      bab = m.babIndex || bab;
      fasl = m.faslIndex ?? fasl;
    } else break;
  }
  return { bab, fasl };
}

function hierarchyPrefix({ bab, fasl }) {
  const b = String(bab).padStart(2, '0');
  if (fasl > 0) return `B${b}-F${String(fasl).padStart(2, '0')}-`;
  return `B${b}-`;
}

/**
 * Apply B{bb}-F{ff}- sortKey prefix for commerce (article resets per باب).
 */
function applyCommerceHierarchyPrefix(units, htmlOrText) {
  const { markers } = extractBabFaslMarkers(htmlOrText);
  const notes = [];
  if (markers.filter((m) => m.type === 'bab').length === 0) {
    notes.push('commerce: no باب markers found — prefix not applied');
    return {
      units,
      structureReport: { babFaslMarkers: markers, prefixApplied: false, prefixNotes: notes },
      prefixApplied: false
    };
  }

  const cloned = units.map((u) => ({ ...u }));
  const seenFull = new Set();
  for (const u of cloned) {
    const h = hierarchyAtLine(markers, u.lineIndex || 0);
    const prefix = hierarchyPrefix(h);
    let key = String(u.sortKey).startsWith(prefix) ? u.sortKey : `${prefix}${u.sortKey}`;
    if (seenFull.has(key)) {
      let v = 2;
      while (seenFull.has(`${key}-o${v}`)) v += 1;
      key = `${key}-o${v}`;
    }
    seenFull.add(key);
    u.sortKey = key;
    u.articleNumber = key;
  }

  notes.push(
    `commerce: باب markers=${markers.filter((m) => m.type === 'bab').length}, فصل markers=${markers.filter((m) => m.type === 'fasl').length}`
  );

  return {
    units: cloned,
    structureReport: {
      babFaslMarkers: markers.slice(0, 40),
      prefixApplied: true,
      prefixMode: 'bab-fasl',
      prefixNotes: notes
    },
    prefixApplied: true
  };
}

module.exports = {
  extractBabFaslMarkers,
  applyCommerceHierarchyPrefix,
  hierarchyPrefix
};
