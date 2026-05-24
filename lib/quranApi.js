import { isOnlyQuranicAnnotation } from './arabicUtils';

const QURAN_API_BASE = 'https://api.quran.com/api/v4';

function hasImlaeiText(word) {
  const imlaei = word.text_imlaei;
  return imlaei != null && imlaei.trim().length > 0;
}

/**
 * Fetch Arabic text for a single ayah from quran.com.
 *
 * @param {number} surahNumber
 * @param {number} ayahNumber
 * @returns {Promise<{
 *   textDisplay: string,
 *   textCompare: string,
 *   words: { textDisplay: string, textCompare: string }[]
 * }>}
 */
export async function getAyah(surahNumber, ayahNumber) {
  const ayahKey = `${surahNumber}:${ayahNumber}`;
  const url = `${QURAN_API_BASE}/verses/by_key/${ayahKey}?words=true&word_fields=text_uthmani,text_imlaei`;

  let response;
  try {
    response = await fetch(url);
  } catch (err) {
    throw new Error(
      `Failed to fetch ayah ${ayahKey}: ${err.message ?? 'network error'}`
    );
  }

  if (!response.ok) {
    throw new Error(
      `Failed to fetch ayah ${ayahKey} (HTTP ${response.status})`
    );
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`Invalid response when fetching ayah ${ayahKey}`);
  }

  const rawWords = data?.verse?.words;
  if (!Array.isArray(rawWords)) {
    throw new Error(`Ayah ${ayahKey} not found`);
  }

  const words = rawWords
    .filter((word) => word.char_type_name === 'word')
    .filter((word) => !isOnlyQuranicAnnotation(word.text_uthmani ?? ''))
    .filter(hasImlaeiText)
    .map((word) => ({
      textDisplay: word.text_uthmani,
      textCompare: word.text_imlaei ?? word.text_uthmani,
    }));

  if (words.length === 0) {
    throw new Error(`No words returned for ayah ${ayahKey}`);
  }

  const textDisplay = words.map((word) => word.textDisplay).join(' ');
  const textCompare = words.map((word) => word.textCompare).join(' ');

  return { textDisplay, textCompare, words };
}
