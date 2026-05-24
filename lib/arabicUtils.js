/** Tashkeel, tatweel/kashida (U+0640), and superscript alef (U+0670). */
const TASHKEEL_PATTERN = /[\u0610-\u061A\u0640\u064B-\u065F\u0670]/g;
/** Quranic pause / annotation marks (e.g. ۚ ۖ ۗ) — not spoken in recitation. */
const QURANIC_ANNOTATION_PATTERN = /[\u06D6-\u06ED]/g;
const QURANIC_ANNOTATION_ONLY_PATTERN = /^[\u06D6-\u06ED]+$/;
const HAMZA_VARIANTS_PATTERN = /[أإآٱ]/g;
const ALEF_MAQSURA_PATTERN = /ى/g;

/**
 * True if the string contains only Quranic pause/annotation marks (no spoken words).
 */
export function isOnlyQuranicAnnotation(text) {
  return QURANIC_ANNOTATION_ONLY_PATTERN.test(text);
}

/**
 * Normalize Arabic text for comparison: strip tashkeel and annotation marks,
 * unify letter variants, trim.
 */
export function normalizeArabic(text) {
  return text
    .replace(TASHKEEL_PATTERN, '')
    .replace(QURANIC_ANNOTATION_PATTERN, '')
    .replace(HAMZA_VARIANTS_PATTERN, 'ا')
    .replace(ALEF_MAQSURA_PATTERN, 'ي')
    .trim();
}

function splitWords(text) {
  return text.split(/\s+/).filter((w) => w.length > 0);
}

const GAP_COST = 1;
const SUBSTITUTION_MISMATCH_COST = 2;

/**
 * Word-level sequence alignment (Needleman–Wunsch / Levenshtein at word granularity).
 * Gap cost 1, substitution mismatch cost 2 — prefers skipping a word over cascading substitutions.
 */
function alignWords(expectedWords, transcribedWords) {
  const m = expectedWords.length;
  const n = transcribedWords.length;

  if (m === 0) {
    return [];
  }

  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    dp[i][0] = i * GAP_COST;
  }
  for (let j = 1; j <= n; j++) {
    dp[0][j] = j * GAP_COST;
  }

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const isMatch = expectedWords[i - 1] === transcribedWords[j - 1];

      if (isMatch) {
        dp[i][j] = dp[i - 1][j - 1];
        continue;
      }

      const deleteCost = dp[i - 1][j] + GAP_COST;
      const insertCost = dp[i][j - 1] + GAP_COST;
      const substituteCost = dp[i - 1][j - 1] + SUBSTITUTION_MISMATCH_COST;

      // Prefer gaps over substitution when costs are tied (e.g. merged Whisper words).
      dp[i][j] = Math.min(deleteCost, insertCost, substituteCost);
    }
  }

  const alignment = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    // 1. Exact match (diagonal, zero cost)
    if (
      i > 0 &&
      j > 0 &&
      expectedWords[i - 1] === transcribedWords[j - 1] &&
      dp[i][j] === dp[i - 1][j - 1]
    ) {
      alignment.unshift({ word: expectedWords[i - 1], status: 'correct' });
      i--;
      j--;
      continue;
    }
    // 2. Substitution — checked BEFORE deletion/insertion to keep i and j in sync on ties
    if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + SUBSTITUTION_MISMATCH_COST) {
      alignment.unshift({ word: expectedWords[i - 1], status: 'wrong' });
      i--;
      j--;
      continue;
    }
    // 3. Deletion (expected word missing from recitation)
    if (i > 0 && dp[i][j] === dp[i - 1][j] + GAP_COST) {
      alignment.unshift({ word: expectedWords[i - 1], status: 'missing' });
      i--;
      continue;
    }
    // 4. Insertion (transcribed word not in expected — stutter, filler — skip silently)
    if (j > 0 && dp[i][j] === dp[i][j - 1] + GAP_COST) {
      j--;
      continue;
    }
    break;
  }

  return alignment;
}

/**
 * Compare two normalized Arabic strings word by word.
 * Returns { word, status }[] where status is 'correct' | 'wrong' | 'missing'.
 */
export function wordDiff(expected, transcribed) {
  const expectedWords = splitWords(expected);
  const transcribedWords = splitWords(transcribed);
  return alignWords(expectedWords, transcribedWords);
}

/*
 * Example (Al-Fatiha 1:1 — Uthmanic spelling variant vs real mistake):
 *
 * normalizeArabic('ٱلرَّحْمَـٰنِ') === normalizeArabic('الرحمن'); // true (Uthmanic → simple script)
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
 *
 * Insertion in transcription — later words still align correctly:
 *
 * wordDiff('ا ب ج', 'ا x ب ج');
 * // [
 * //   { word: 'ا', status: 'correct' },
 * //   { word: 'ب', status: 'correct' },
 * //   { word: 'ج', status: 'correct' },
 * // ]
 */
