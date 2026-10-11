/**
 * Structural analysis of qavanin BorderText (books, section headers, sortKey collisions).
 * Does not modify law text — metadata only for prefix decisions.
 */
const { htmlToPlainText } = require('./qavanin-border-parser');

function linesFromHtmlOrText(htmlOrText) {
  const text = htmlOrText.includes('<')
    ? htmlToPlainText(htmlOrText)
    : String(htmlOrText);
  return text
    .split('\n')
    .map((l) => l.replace(/\u0640/g, '').trim())
    .filter((l) => l.length > 0);
}

const BOOK_LINE =
  /^كتاب\s+(اول|دوم|سوم|چهارم|پنجم|ششم|هفتم|هشتم|نهم|دهم|\d+|[\u06F0-\u06F9]+)/u;

const KNOWN_SECTION_SKIP =
  /^(?:جلد|كتاب|باب|فصل|مبحث|قسمت|فقره|شماره|مقدمه|قانون\s+مد|مصوب|با\s+اصلاحات)/;

const MADDE_LINE = /^ماده\s+(\d+)/;

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

function bookIndexFromHeader(line) {
  const m = line.match(BOOK_LINE);
  if (!m) return null;
  const token = m[1];
  if (PERSIAN_ORDINAL_TO_N[token]) return PERSIAN_ORDINAL_TO_N[token];
  const digits = token.replace(/[\u06F0-\u06F9]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0x06f0 + 48)
  );
  const n = Number(digits);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function analyzeStructure(htmlOrText) {
  const lines = linesFromHtmlOrText(htmlOrText);

  const bookMarkers = [];
  const unknownSectionHeaders = [];
  const madddeAtLine = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const bookIdx = bookIndexFromHeader(line);
    if (bookIdx != null && BOOK_LINE.test(line)) {
      bookMarkers.push({ lineIndex: i + 1, bookIndex: bookIdx, header: line.slice(0, 120) });
      continue;
    }
    if (KNOWN_SECTION_SKIP.test(line) && !/^ماده/.test(line) && !/^تبصره/.test(line)) {
      continue;
    }
    if (
      /^(?:باب|فصل|مبحث|قسمت|فقره|جلد)\s+/u.test(line) &&
      !/^ماده/.test(line) &&
      !/^تبصره/.test(line)
    ) {
      continue;
    }
    if (/^(?:باب|فصل|مبحث|قسمت|فقره|جلد)\s+/u.test(line)) {
      unknownSectionHeaders.push({ lineIndex: i + 1, header: line.slice(0, 120) });
    }

    const mm = line.match(MADDE_LINE);
    if (mm) {
      madddeAtLine.push({ lineIndex: i + 1, base: mm[1], header: line.slice(0, 100) });
    }
  }

  return { bookMarkers, unknownSectionHeaders, madddeAtLine, lineCount: lines.length };
}

function bookForLineIndex(bookMarkers, lineIndex) {
  let book = null;
  for (const m of bookMarkers) {
    if (m.lineIndex <= lineIndex) book = m.bookIndex;
    else break;
  }
  return book;
}

function detectNumberingResets(madddeAtLine, bookMarkers) {
  const resets = [];
  if (bookMarkers.length === 0 || madddeAtLine.length === 0) {
    return { resets, hasBookStructure: bookMarkers.length > 0 };
  }

  for (let b = 0; b < bookMarkers.length; b += 1) {
    const startLine = bookMarkers[b].lineIndex;
    const endLine = bookMarkers[b + 1]?.lineIndex ?? Infinity;
    const inBook = madddeAtLine.filter((m) => m.lineIndex >= startLine && m.lineIndex < endLine);
    if (inBook.length === 0) continue;
    const firstBase = Number(inBook[0].base);
    resets.push({
      bookIndex: bookMarkers[b].bookIndex,
      firstArticleBase: inBook[0].base,
      firstAtLine: inBook[0].lineIndex,
      resetsToOne: firstBase === 1 && b > 0
    });
  }
  return {
    resets,
    hasBookStructure: true,
    anyResetAfterBook1: resets.some((r, idx) => idx > 0 && r.resetsToOne)
  };
}

function findDuplicateSortKeys(units) {
  const seen = new Map();
  const dups = [];
  for (const u of units) {
    if (seen.has(u.sortKey)) {
      dups.push({ sortKey: u.sortKey, lines: [seen.get(u.sortKey), u.lineIndex] });
    } else {
      seen.set(u.sortKey, u.lineIndex);
    }
  }
  return dups;
}

/**
 * Apply K{n}- prefix to sortKey/articleNumber when structure requires disambiguation.
 * Returns { units, structureReport, prefixApplied, prefixNotes }.
 */
function applyBookPrefixIfNeeded(units, htmlOrText, lawKey, options = {}) {
  const structure = analyzeStructure(htmlOrText);
  const numbering = detectNumberingResets(structure.madddeAtLine, structure.bookMarkers);
  const duplicateSortKeys = findDuplicateSortKeys(units);

  const notes = [];
  let prefixApplied = false;
  let prefixMode = 'none';

  if (lawKey === 'commerce') {
    return {
      units,
      structureReport: {
        ...structure,
        numbering,
        duplicateSortKeys,
        prefixApplied: false,
        prefixMode: 'none',
        prefixNotes: ['commerce: hierarchy prefix handled separately']
      },
      prefixApplied: false,
      prefixNotes: []
    };
  }

  const expectsBooks =
    lawKey === 'ipc-1392' || lawKey === 'ipc-book5' || options.bookAware === true;

  if (lawKey === 'ipc-book5') {
    const books = structure.bookMarkers.map((b) => b.bookIndex);
    if (books.length === 0) {
      notes.push('ipc-book5: no كتاب header found; applying K5- only if duplicate sortKeys exist');
    } else if (books.some((b) => b !== 5)) {
      notes.push(
        `ipc-book5: unexpected book indices in headers: ${[...new Set(books)].join(', ')} — report only`
      );
    }
  }

  if (lawKey === 'ipc-1392') {
    const bookIndices = [...new Set(structure.bookMarkers.map((b) => b.bookIndex))].sort(
      (a, b) => a - b
    );
    notes.push(`ipc-1392: book markers found: ${bookIndices.length ? bookIndices.join(', ') : 'none'}`);
    if (numbering.anyResetAfterBook1) {
      notes.push('ipc-1392: article numbering resets at book boundary (detected ماده 1 after book break)');
    } else if (structure.bookMarkers.length > 1) {
      notes.push('ipc-1392: multiple books but no reset-to-1 detected at boundaries (continuous numbering?)');
    }
  }

  const needPrefix =
    duplicateSortKeys.length > 0 ||
    (expectsBooks && numbering.anyResetAfterBook1) ||
    (lawKey === 'ipc-book5' && duplicateSortKeys.length > 0);

  if (!needPrefix && duplicateSortKeys.length === 0) {
    return {
      units,
      structureReport: {
        ...structure,
        numbering,
        duplicateSortKeys,
        prefixApplied: false,
        prefixMode: 'none',
        prefixNotes: notes
      },
      prefixApplied: false,
      prefixNotes: notes
    };
  }

  if (duplicateSortKeys.length > 0) {
    notes.push(`duplicate sortKeys before prefix: ${duplicateSortKeys.length} collision(s)`);
    prefixMode = 'collision-disambiguation';
  } else if (numbering.anyResetAfterBook1) {
    prefixMode = 'book-reset';
  }

  const cloned = units.map((u) => ({ ...u }));
  for (const u of cloned) {
    let book = bookForLineIndex(structure.bookMarkers, u.lineIndex || 0);
    if (lawKey === 'ipc-book5' && book == null) book = 5;
    if (book == null) {
      notes.push(`unit at line ${u.lineIndex} has no book context — prefix skipped for ${u.sortKey}`);
      continue;
    }
    const prefix = `K${book}-`;
    if (String(u.sortKey).startsWith(prefix)) continue;
    u.sortKey = `${prefix}${u.sortKey}`;
    u.articleNumber = u.sortKey;
    prefixApplied = true;
  }

  const afterDup = findDuplicateSortKeys(cloned);
  if (afterDup.length) {
    notes.push(`WARNING: duplicate sortKeys remain after prefix: ${afterDup.length}`);
  }

  return {
    units: cloned,
    structureReport: {
      ...structure,
      numbering,
      duplicateSortKeysBefore: duplicateSortKeys,
      duplicateSortKeysAfter: afterDup,
      prefixApplied,
      prefixMode,
      prefixNotes: notes
    },
    prefixApplied,
    prefixNotes: notes
  };
}

module.exports = {
  analyzeStructure,
  detectNumberingResets,
  findDuplicateSortKeys,
  applyBookPrefixIfNeeded,
  bookForLineIndex
};
