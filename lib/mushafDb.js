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
