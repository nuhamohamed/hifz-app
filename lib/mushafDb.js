/**
 * Query helpers for the bundled mushaf database (assets/mushaf.db).
 *
 * Tables:
 *   words — id, location ("surah:ayah:word"), surah, ayah, word, text
 *           (QPC Hafs Unicode text; the ayah-end number marker is the last
 *           "word" of every ayah, e.g. ١)
 *   pages — page_number, line_number (1–15), line_type
 *           ('surah_name' | 'basmallah' | 'ayah'), is_centered,
 *           first_word_id, last_word_id, surah_number
 *   surahs — number, name_arabic
 *
 * All functions take the SQLiteDatabase instance from useSQLiteContext().
 */

const ARABIC_DIGITS_PATTERN = /^[٠-٩۰-۹]+$/;

/** True for the ayah-end number marker rows (e.g. ١٢٣). */
export function isAyahMarker(wordText) {
  return ARABIC_DIGITS_PATTERN.test(wordText);
}

/** The mushaf page number an ayah starts on. */
export async function getPageForAyah(db, surah, ayah) {
  const row = await db.getFirstAsync(
    `SELECT p.page_number AS page
       FROM pages p
       JOIN words w ON w.id BETWEEN p.first_word_id AND p.last_word_id
      WHERE p.line_type = 'ayah' AND w.surah = ? AND w.ayah = ? AND w.word = 1
      LIMIT 1`,
    [surah, ayah]
  );
  return row?.page ?? null;
}

/**
 * All 15 lines of a mushaf page, each with its words.
 *
 * @returns {Promise<{
 *   lineNumber: number,
 *   lineType: 'surah_name' | 'basmallah' | 'ayah',
 *   isCentered: boolean,
 *   surahNumber: number | null,
 *   surahName: string | null,
 *   words: { id, location, surah, ayah, word, text, isMarker }[]
 * }[]>}
 */
export async function getPageLines(db, pageNumber) {
  const lineRows = await db.getAllAsync(
    `SELECT line_number, line_type, is_centered, first_word_id, last_word_id,
            surah_number
       FROM pages
      WHERE page_number = ?
      ORDER BY line_number`,
    [pageNumber]
  );

  const lines = [];
  for (const line of lineRows) {
    let words = [];
    let surahName = null;
    if (line.line_type === 'surah_name' && line.surah_number != null) {
      const row = await db.getFirstAsync(
        'SELECT name_arabic FROM surahs WHERE number = ?',
        [line.surah_number]
      );
      surahName = row?.name_arabic ?? null;
    }
    if (line.line_type === 'ayah') {
      const wordRows = await db.getAllAsync(
        `SELECT id, location, surah, ayah, word, text
           FROM words
          WHERE id BETWEEN ? AND ?
          ORDER BY id`,
        [line.first_word_id, line.last_word_id]
      );
      words = wordRows.map((w) => ({ ...w, isMarker: isAyahMarker(w.text) }));
    }
    lines.push({
      lineNumber: line.line_number,
      lineType: line.line_type,
      isCentered: line.is_centered === 1,
      surahNumber: line.surah_number ?? null,
      surahName,
      words,
    });
  }
  return lines;
}

/**
 * Spoken (non-marker) words of an ayah in mushaf order. Index in this array
 * corresponds to the word index used by quranApi/wordDiff.
 */
export async function getSpokenWordsForAyah(db, surah, ayah) {
  const rows = await db.getAllAsync(
    `SELECT id, location, surah, ayah, word, text
       FROM words
      WHERE surah = ? AND ayah = ?
      ORDER BY word`,
    [surah, ayah]
  );
  return rows.filter((w) => !isAyahMarker(w.text));
}

/**
 * Page number and word count for every ayah of a juz, in recitation order.
 *
 * This is the foundation of portion sizing. A portion is budgeted in *pages*
 * rather than ayahs, because a page takes a roughly constant time to recite
 * while an ayah does not: pages hold anywhere from 1 to 40 ayahs (10.3 on
 * average), so converting minutes to ayahs through that average is wrong by
 * up to 5x. Al-Baqarah runs 5.5 ayahs to a page and juz 30 runs 28.2, which is
 * how a "30 minute" session became 39 minutes in one and 8 in the other.
 *
 * One query per juz (~150 rows) rather than one per ayah. `page` is the page
 * an ayah *starts* on; an ayah spanning a page break counts against the page
 * it began on, which is what "how far can I get in N pages" needs.
 *
 * `wordCount` includes the ayah-end number marker, so it overstates every ayah
 * by exactly one word. That is harmless for the page-share arithmetic it feeds
 * (quiz timing), since the marker is a constant across all ayahs.
 *
 * @param {import('expo-sqlite').SQLiteDatabase} db
 * @param {{ surahNumber: number, startAyah: number, endAyah: number }[]} segments
 *        The juz's surah segments, in order, from JUZ_DATA[n].surahs.
 * @returns {Promise<{ surah: number, ayah: number, page: number, wordCount: number }[]>}
 *          Index i holds juz-relative offset i + 1.
 */
let pageIndexCache = null;

/**
 * Every 'ayah' line in the mushaf, ordered by word id, plus the total words on
 * each page. Loaded once and kept: the mushaf does not change.
 *
 * Deliberately NOT done as a SQL join. Matching words to pages with
 * `w.id BETWEEN p.first_word_id AND p.last_word_id` has no index to work with,
 * so it compares 83,668 words against 8,820 lines: measured at 32 seconds,
 * which hangs the Today screen. Fetching the 8,820 line ranges (18ms) and
 * matching in JavaScript by binary search is the same answer in microseconds.
 *
 * A page's word count is arithmetic on the line ranges alone, since word ids
 * are contiguous within a line. Verified identical to counting the words.
 */
async function loadPageIndex(db) {
  if (pageIndexCache) return pageIndexCache;

  const lines = await db.getAllAsync(
    `SELECT page_number AS page, first_word_id AS firstId, last_word_id AS lastId
       FROM pages
      WHERE line_type = 'ayah'
      ORDER BY first_word_id`
  );

  const totals = new Map();
  for (const line of lines) {
    const words = line.lastId - line.firstId + 1;
    totals.set(line.page, (totals.get(line.page) ?? 0) + words);
  }

  pageIndexCache = { lines, totals };
  return pageIndexCache;
}

/** Which page a given word id falls on. Binary search over the sorted lines. */
function pageForWordId(lines, wordId) {
  let lo = 0;
  let hi = lines.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const line = lines[mid];
    if (wordId < line.firstId) hi = mid - 1;
    else if (wordId > line.lastId) lo = mid + 1;
    else return line.page;
  }
  return null;
}

/**
 * Page number and word count for every ayah of a juz, in recitation order.
 *
 * This is the foundation of portion sizing. A portion is budgeted in *pages*
 * rather than ayahs, because a page takes a roughly constant time to recite
 * while an ayah does not: pages hold anywhere from 1 to 40 ayahs (10.3 on
 * average), so converting minutes to ayahs through that average is wrong by
 * up to 5x. Al-Baqarah runs 5.5 ayahs to a page and juz 30 runs 28.2, which is
 * how a "30 minute" session became 39 minutes in one and 8 in the other.
 *
 * `page` is the page an ayah *starts* on; an ayah spanning a page break counts
 * against the page it began on, which is what "how far can I get" needs.
 *
 * `wordCount` includes the ayah-end number marker, so it overstates every ayah
 * by exactly one word. Harmless for the page-share arithmetic it feeds, since
 * the marker is a constant across all ayahs.
 *
 * @param {import('expo-sqlite').SQLiteDatabase} db
 * @param {{ surahNumber: number, startAyah: number, endAyah: number }[]} segments
 *        The juz's surah segments, in order, from JUZ_DATA[n].surahs.
 * @returns {Promise<{ surah: number, ayah: number, page: number,
 *                     wordCount: number, pageShare: number }[]>}
 *          Index i holds juz-relative offset i + 1.
 */
export async function getJuzAyahPages(db, segments) {
  if (!segments?.length) return [];

  const where = segments
    .map(() => '(surah = ? AND ayah BETWEEN ? AND ?)')
    .join(' OR ');
  const params = segments.flatMap((s) => [s.surahNumber, s.startAyah, s.endAyah]);

  // Uses idx_words_loc. ~150 rows, 12ms.
  const rows = await db.getAllAsync(
    `SELECT surah, ayah, COUNT(*) AS wordCount, MIN(id) AS firstWordId
       FROM words
      WHERE ${where}
      GROUP BY surah, ayah
      ORDER BY surah, ayah`,
    params
  );

  const { lines, totals } = await loadPageIndex(db);

  return rows.map((r) => {
    const page = pageForWordId(lines, r.firstWordId);
    const pageWords = totals.get(page) ?? r.wordCount;
    return {
      surah: r.surah,
      ayah: r.ayah,
      page,
      wordCount: r.wordCount,
      // Fraction of a page this ayah occupies, and therefore the fraction of
      // `avg_minutes_per_page` it costs to recite. This is what lets a portion
      // be budgeted in time rather than snapped to whole page boundaries, and
      // what makes quiz timing honest: An-Naba 1 is 2% of a page (3 seconds)
      // while Al-Baqarah 282 is a page on its own (two minutes).
      pageShare: r.wordCount / pageWords,
    };
  });
}
