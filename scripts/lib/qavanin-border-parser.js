/**
 * Experimental parser for qavanin.ir BorderText (div.BorderText.treeTextView).
 * No law text is embedded here — feed HTML or plain text from a live fetch.
 */

const SECTION_LINE =
  /^(?:جلد|كتاب|باب|فصل|مبحث|قسمت|فقره|شماره|مقدمه|قانون\s+مد|مصوب|با\s+اصلاحات)/;

const DIGITS = '[0-9\\u0660-\\u0669\\u06F0-\\u06F9]+';

const RE_TABSER_NUM =
  new RegExp(
    `^تبصره\\s+(${DIGITS})\\s*(?:\\((اصلاحي|الحاقي)\\s*([^)]+)\\))?\\s*[-–—]?\\s*(.*)$`,
    'u'
  );
const RE_TABSER =
  /^تبصره(?:\s*\((اصلاحي|الحاقي)\s*([^)]+)\))?\s*[-–—]?\s*(.*)$/u;
const RE_MOKARR = new RegExp(
  `^ماده\\s+(${DIGITS})\\s+مكرر(?:\\s*\\((الحاقي|اصلاحي)\\s*([^)]+)\\))?\\s*[-–—]?\\s*(.*)$`,
  'u'
);
const RE_MADDE = new RegExp(
  `^ماده\\s+(${DIGITS})(?:\\s*\\((اصلاحي|الحاقي|منسوخه|جایگزین)\\s*([^)]+)\\))?\\s*[-–—]?\\s*(.*)$`,
  'u'
);

function normalizeDate(raw) {
  if (!raw) return null;
  return String(raw)
    .replace(/\u02cf/g, '/')
    .replace(/[٫،]/g, '/')
    .replace(/\s+/g, '')
    .trim() || null;
}

function normalizeDigits(raw) {
  return String(raw || '')
    .replace(/[\u0660-\u0669]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x0660 + 48))
    .replace(/[\u06F0-\u06F9]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x06f0 + 48));
}

function padArticle(n) {
  const num = Number(normalizeDigits(n));
  if (!Number.isFinite(num)) return '00000';
  return String(num).padStart(5, '0');
}

function htmlToPlainText(html) {
  const withBreaks = String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n');
  const stripped = withBreaks.replace(/<[^>]+>/g, '');
  return stripped
    .replace(/\u0640/g, '')
    .replace(/\r\n/g, '\n');
}

function linesFromInput(htmlOrText) {
  const text = htmlOrText.includes('<')
    ? htmlToPlainText(htmlOrText)
    : String(htmlOrText);
  return text
    .split('\n')
    .map((l) => l.replace(/\u0640/g, '').trim())
    .filter((l) => l.length > 0);
}

function unitTypeFromMaddde(kindInParen) {
  if (kindInParen === 'اصلاحي') return 'amended';
  if (kindInParen === 'الحاقي') return 'elhaqi';
  return 'ordinary';
}

/**
 * @param {string} htmlOrText - raw BorderText innerHTML or innerText
 * @returns {{ units: object[], ambiguities: string[] }}
 */
function parseBorderText(htmlOrText) {
  const lines = linesFromInput(htmlOrText);
  const units = [];
  const ambiguities = [];

  let current = null;
  let lastArticleBase = null;
  const tabseraCount = new Map();
  const mokarrarCount = new Map();
  const usedMadddeSortKeys = new Set();
  let preambleTabseraCount = 0;

  function assignMadddeSortKey(base, unitType) {
    const padded = padArticle(base);
    if (!usedMadddeSortKeys.has(padded)) {
      usedMadddeSortKeys.add(padded);
      return padded;
    }
    if (unitType === 'amended') {
      let e = 1;
      while (usedMadddeSortKeys.has(`${padded}-e${e}`)) e += 1;
      const key = `${padded}-e${e}`;
      usedMadddeSortKeys.add(key);
      return key;
    }
    return padded;
  }

  function flush() {
    if (!current) return;
    current.content = current.content.trim();
    if (!current.content && !current._hadInlineBody) {
      ambiguities.push(
        `Empty content for ${current.unitType} displayNumber=${current.displayNumber} sortKey=${current.sortKey}`
      );
    }
    delete current._hadInlineBody;
    units.push(current);
    current = null;
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (SECTION_LINE.test(line) && !/^ماده/.test(line) && !/^تبصره/.test(line)) {
      continue;
    }

    let m = line.match(RE_TABSER_NUM);
    if (m) {
      flush();
      const tabseraLabel = normalizeDigits(m[1]);
      let parentBase = lastArticleBase;
      let sortKey;
      let displayNumber;
      if (!parentBase) {
        preambleTabseraCount += 1;
        const n = preambleTabseraCount;
        parentBase = '0';
        sortKey = `00000-n${n}`;
        displayNumber = `تبصره ${tabseraLabel} (preamble)`;
      } else {
        const n = (tabseraCount.get(parentBase) || 0) + 1;
        tabseraCount.set(parentBase, n);
        sortKey = `${padArticle(parentBase)}-n${n}`;
        displayNumber = `تبصره ${tabseraLabel} (${parentBase})`;
      }
      const kind = m[2] || null;
      const dateRaw = m[3] || null;
      const inline = (m[4] || '').trim();
      current = {
        articleNumber: sortKey,
        displayNumber,
        unitType: 'tabsera',
        content: inline,
        amendmentDate: kind === 'اصلاحي' ? normalizeDate(dateRaw) : null,
        additionDate: kind === 'الحاقي' ? normalizeDate(dateRaw) : null,
        sortKey,
        baseNumber: parentBase,
        lineIndex: i + 1
      };
      if (inline) current._hadInlineBody = true;
      continue;
    }

    m = line.match(RE_TABSER);
    if (m) {
      flush();
      let parentBase = lastArticleBase;
      let sortKey;
      let displayNumber;
      if (!parentBase) {
        preambleTabseraCount += 1;
        const n = preambleTabseraCount;
        parentBase = '0';
        sortKey = `00000-n${n}`;
        displayNumber = n === 1 ? 'تبصره (preamble)' : `تبصره ${n} (preamble)`;
      } else {
        const n = (tabseraCount.get(parentBase) || 0) + 1;
        tabseraCount.set(parentBase, n);
        sortKey = `${padArticle(parentBase)}-n${n}`;
        displayNumber = n === 1 ? `تبصره (${parentBase})` : `تبصره ${n} (${parentBase})`;
      }
      const kind = m[1] || null;
      const dateRaw = m[2] || null;
      const inline = (m[3] || '').trim();
      current = {
        articleNumber: sortKey,
        displayNumber,
        unitType: 'tabsera',
        content: inline,
        amendmentDate: kind === 'اصلاحي' ? normalizeDate(dateRaw) : null,
        additionDate: kind === 'الحاقي' ? normalizeDate(dateRaw) : null,
        sortKey,
        baseNumber: parentBase,
        lineIndex: i + 1
      };
      if (inline) current._hadInlineBody = true;
      continue;
    }

    m = line.match(RE_MOKARR);
    if (m) {
      flush();
      const base = normalizeDigits(m[1]);
      lastArticleBase = base;
      const r = (mokarrarCount.get(base) || 0) + 1;
      mokarrarCount.set(base, r);
      const kind = m[2] || null;
      const dateRaw = m[3] || null;
      const inline = (m[4] || '').trim();
      const unitType = kind === 'الحاقي' ? 'elhaqi' : 'mokarrar';
      current = {
        articleNumber: base,
        displayNumber: r === 1 ? `${base} مكرر` : `${base} مكرر ${r}`,
        unitType,
        content: inline,
        amendmentDate: kind === 'اصلاحي' ? normalizeDate(dateRaw) : null,
        additionDate: kind === 'الحاقي' ? normalizeDate(dateRaw) : null,
        sortKey: `${padArticle(base)}-r${r}`,
        baseNumber: base,
        lineIndex: i + 1
      };
      if (inline) current._hadInlineBody = true;
      continue;
    }

    m = line.match(RE_MADDE);
    if (m) {
      flush();
      const base = normalizeDigits(m[1]);
      lastArticleBase = base;
      const kind = m[2] || null;
      const dateRaw = m[3] || null;
      const inline = (m[4] || '').trim();
      const unitType = unitTypeFromMaddde(kind);
      const sortKey = assignMadddeSortKey(base, unitType);
      current = {
        articleNumber: sortKey,
        displayNumber: base,
        unitType,
        content: inline,
        amendmentDate: kind === 'اصلاحي' ? normalizeDate(dateRaw) : null,
        additionDate: kind === 'الحاقي' ? normalizeDate(dateRaw) : null,
        sortKey,
        baseNumber: base,
        lineIndex: i + 1
      };
      if (inline) current._hadInlineBody = true;
      continue;
    }

    if (new RegExp(`^ماده\\s+${DIGITS}`).test(line) || /^تبصره/.test(line)) {
      ambiguities.push(`Unrecognized unit header at line ${i + 1}: ${line.slice(0, 80)}`);
    }

    if (current) {
      current.content = current.content ? `${current.content}\n${line}` : line;
    }
  }

  flush();

  return { units, ambiguities };
}

function countByType(units) {
  const counts = {
    ordinary: 0,
    amended: 0,
    mokarrar: 0,
    elhaqi: 0,
    tabsera: 0,
    madddeOccurrences: 0
  };
  for (const u of units) {
    if (u.unitType === 'ordinary') counts.ordinary += 1;
    else if (u.unitType === 'amended') counts.amended += 1;
    else if (u.unitType === 'mokarrar') counts.mokarrar += 1;
    else if (u.unitType === 'elhaqi') counts.elhaqi += 1;
    else if (u.unitType === 'tabsera') counts.tabsera += 1;
    if (u.unitType !== 'tabsera') counts.madddeOccurrences += 1;
  }
  return counts;
}

function contentHasNestedUnitHeader(content) {
  if (!content) return false;
  return content.split('\n').some((l) => RE_MADDE.test(l.trim()) || RE_MOKARR.test(l.trim()) || RE_TABSER.test(l.trim()));
}

function findUnit(units, predicate) {
  return units.find(predicate) || null;
}

module.exports = {
  parseBorderText,
  htmlToPlainText,
  countByType,
  contentHasNestedUnitHeader,
  findUnit,
  padArticle,
  normalizeDigits
};
