/** Tashkeel, tatweel/kashida (U+0640), and superscript alef (U+0670). */
const TASHKEEL_PATTERN = /[\u0610-\u061A\u0640\u064B-\u065F\u0670]/g;
const HAMZA_VARIANTS_PATTERN = /[أإآٱ]/g;
const ALEF_MAQSURA_PATTERN = /ى/g;
const ARABIC_LETTER_PATTERN = /[\u0621-\u064A]/;
const MATER_LECTIONIS_PATTERN = /[اوي]/;
const ORTHOGRAPHIC_VOWEL_PATTERN = /[اوي]/;

/**
 * True for Arabic letters other than mater lectionis (ا و ي), i.e. consonantal neighbors.
 */
function isConsonantalLetter(char) {
  return ARABIC_LETTER_PATTERN.test(char) && !MATER_LECTIONIS_PATTERN.test(char);
}

/**
 * Whether a mater lectionis (ا و ي) is a silent Uthmanic extension, not part of the root.
 * - ا between consonants (e.g. الرحمان → الرحمن)
 * - و between consonants, but not as the second letter (preserves موسى)
 * - ي between consonants, but not the حيم of الرحيم (preserves the فعيل pattern)
 */
function isOrthographicVowelExtension(char, index, chars) {
  const prev = chars[index - 1];
  const next = chars[index + 1];

  const betweenConsonants =
    prev &&
    next &&
    isConsonantalLetter(prev) &&
    isConsonantalLetter(next);

  if (!betweenConsonants) {
    return false;
  }

  if (char === 'ا') {
    return true;
  }

  if (char === 'و') {
    return index !== 1;
  }

  if (char === 'ي') {
    return !(prev === 'ح' && next === 'م');
  }

  return false;
}

/**
 * Remove ا و ي used as silent Uthmanic vowel extensions inside words.
 */
function removeOrthographicVowelExtensions(text) {
  const chars = [...text];

  return chars
    .filter((char, index) => {
      if (!ORTHOGRAPHIC_VOWEL_PATTERN.test(char)) {
        return true;
      }

      return !isOrthographicVowelExtension(char, index, chars);
    })
    .join('');
}

/**
 * Normalize Arabic text for comparison: strip tashkeel, unify letter variants,
 * remove Uthmanic orthographic vowel extensions, trim.
 */
export function normalizeArabic(text) {
  return removeOrthographicVowelExtensions(
    text
      .replace(TASHKEEL_PATTERN, '')
      .replace(HAMZA_VARIANTS_PATTERN, 'ا')
      .replace(ALEF_MAQSURA_PATTERN, 'ي')
      .trim()
  );
}

function splitWords(text) {
  return text.split(/\s+/).filter(Boolean);
}

/**
 * Compare two normalized Arabic strings word by word.
 * Returns { word, status }[] where status is 'correct' | 'wrong' | 'missing'.
 */
export function wordDiff(expected, transcribed) {
  const expectedWords = splitWords(expected);
  const transcribedWords = splitWords(transcribed);
  const result = [];

  for (let i = 0; i < expectedWords.length; i++) {
    const word = expectedWords[i];
    const transcribedWord = transcribedWords[i];

    if (transcribedWord === undefined) {
      result.push({ word, status: 'missing' });
    } else if (word === transcribedWord) {
      result.push({ word, status: 'correct' });
    } else {
      result.push({ word, status: 'wrong' });
    }
  }

  return result;
}

/*
 * Example (Al-Fatiha 1:1 — Uthmanic spelling variant vs real mistake):
 *
 * normalizeArabic('الرحمن') === normalizeArabic('الرحمان'); // true (orthographic ا removed)
 *
 * const expected = normalizeArabic('بسم الله الرحمن الرحيم');
 * const transcribed = normalizeArabic('بسم الله الرحمن الرحمان'); // wrong word at end
 *
 * wordDiff(expected, transcribed);
 *
 * [
 *   { word: 'بسم', status: 'correct' },
 *   { word: 'الله', status: 'correct' },
 *   { word: 'الرحمن', status: 'correct' },
 *   { word: 'الرحيم', status: 'wrong' },
 * ]
 */
