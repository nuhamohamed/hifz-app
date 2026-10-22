/** Tashkeel, tatweel/kashida (U+0640), and superscript alef (U+0670). */
const TASHKEEL_PATTERN = /[\u0610-\u061A\u0640\u064B-\u065F\u0670]/g;
/** Quranic pause / annotation marks (e.g. ۚ ۖ ۗ) — not spoken in recitation. */
const QURANIC_ANNOTATION_PATTERN = /[\u06D6-\u06ED]/g;
const QURANIC_ANNOTATION_ONLY_PATTERN = /^[\u06D6-\u06ED]+$/;
const HAMZA_VARIANTS_PATTERN = /[أإآٱ]/g;
// Hamza followed by alef is how the Uthmani script writes آ (ءَايَة, ءَامَنُوا),
// and Speechmatics sometimes spells it that way. آ became ا while ءا stayed,
// so a correctly recited ءاية was "ءايه" against the mushaf's "ايه" and went
// red. Applied after tashkeel is stripped, which is what separates the two.
const HAMZA_ALEF_PATTERN = /ءا/g;
/**
 * Alif maqsura is pronounced "ā", so normalize to alef — NOT ya. STT models
 * spell tanween-fath endings inconsistently (مرضًا may come back as مرضى),
 * and mapping ى → ا makes both sides converge on the same skeleton.
 *
 * Exception: Uthmanic script uses ى for the "ī" sound when the preceding
 * letter carries a kasra (فِى = "fī", STT writes في). That case is resolved
 * to ي BEFORE tashkeel is stripped (KASRA_MAQSURA_PATTERN below).
 */
const KASRA_MAQSURA_PATTERN = /ِى/g; // kasra immediately before maqsura
const MAQSURA_SMALL_YEH_PATTERN = /ىِ?ۦ/g; // maqsura + small yeh = "yī" (يُحْىِۦ → يحيي)
const MAQSURA_KASRA_PATTERN = /ى(?=[ِۧ])/g; // maqsura carrying kasra → "ī" sound
const ALEF_MAQSURA_PATTERN = /ى/g;
const TAA_MARBUTA_PATTERN = /ة/g;
const WAW_HAMZA_PATTERN = /ؤ/g;
const YA_HAMZA_PATTERN = /ئ/g;

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
    .replace(MAQSURA_SMALL_YEH_PATTERN, 'يي')
    .replace(KASRA_MAQSURA_PATTERN, 'ِي')
    .replace(MAQSURA_KASRA_PATTERN, 'ي')
    .replace(TASHKEEL_PATTERN, '')
    .replace(QURANIC_ANNOTATION_PATTERN, '')
    .replace(HAMZA_ALEF_PATTERN, 'ا')
    .replace(HAMZA_VARIANTS_PATTERN, 'ا')
    .replace(ALEF_MAQSURA_PATTERN, 'ا')
    .replace(TAA_MARBUTA_PATTERN, 'ه')
    .replace(WAW_HAMZA_PATTERN, 'و')
    .replace(YA_HAMZA_PATTERN, 'ي')
    .replace(/[.,،؟?!؛;:"'«»“”‘’…()\[\]]/g, '')
    .trim();
}

/**
 * The expected word list for an ayah: one entry per word on the mushaf, in the
 * mushaf's order, normalized for comparison.
 *
 * Every mark, reveal and mistake row is keyed to an index into `ayah.words`,
 * so this is the only list a matcher may be handed. Splitting the ayah's text
 * on whitespace looks equivalent and is not: the moment an imlaei word is
 * spelled as two (see matchedSpokenCount) that list is longer, and every index
 * past the word points at its neighbour for the rest of the ayah.
 */
export function expectedWordsFrom(words) {
  return (words ?? [])
    .map((word) => normalizeArabic(word?.textCompare ?? ''))
    .filter(Boolean);
}

/**
 * How many spoken words a faithful utterance of `expectedWord` accounts for,
 * ending at `end` (exclusive) in `spokenWords`. Zero when it is not there.
 *
 * One word on the mushaf is not always one word out loud. Imlaei spelling
 * writes the vocative as two - يَـٰٓأَيُّهَا is stored as "يَا أَيُّهَا" and
 * يَـٰٓـَٔادَمُ as "يَا آدَمُ" - and Al-Baqarah alone has twenty-five such
 * words. Compared token for token, they can never equal anything a recogniser
 * returns: the word stands red through a flawless recitation, and every
 * matcher that needs to find the ayah's opening loses its place at it.
 *
 * The expected list has to stay one entry per written word, because that is
 * what the screen is keyed to. So the spoken side is where the give is: an
 * entry may be met by the several words it is said as, or by one word when the
 * recogniser runs them together.
 */
export function matchedSpokenCount(expectedWord, spokenWords, end) {
  if (end < 1) return 0;

  const tokens = spokenTokens(expectedWord);
  const start = end - tokens.length;
  if (start >= 0) {
    let matched = true;
    for (let k = 0; k < tokens.length; k++) {
      if (spokenWords[start + k] !== tokens[k]) {
        matched = false;
        break;
      }
    }
    if (matched) return tokens.length;
  }

  // Run together by the recogniser, so the several words arrive as one.
  return spokenWords[end - 1] === tokens.join('') ? 1 : 0;
}

/**
 * The same question asked forwards: how many spoken words a faithful utterance
 * of `expectedWord` accounts for, beginning at `start`. Zero when it is not
 * there.
 *
 * Two entry points because the two callers know different ends of the match.
 * An alignment fills its table right to left and knows where a word finished;
 * a scan looking for the ayah's opening knows where one begins.
 */
export function matchedSpokenCountAt(expectedWord, spokenWords, start) {
  if (start < 0 || start >= spokenWords.length) return 0;

  const tokens = spokenTokens(expectedWord);
  if (start + tokens.length <= spokenWords.length) {
    let matched = true;
    for (let k = 0; k < tokens.length; k++) {
      if (spokenWords[start + k] !== tokens[k]) {
        matched = false;
        break;
      }
    }
    if (matched) return tokens.length;
  }

  // Run together by the recogniser, so the several words arrive as one.
  return spokenWords[start] === tokens.join('') ? 1 : 0;
}

function spokenTokens(expectedWord) {
  return expectedWord.split(' ').filter(Boolean);
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
      // A written word may be said as more than one (matchedSpokenCount), so
      // what a match consumes is asked rather than assumed to be one word.
      const matched = matchedSpokenCount(expectedWords[i - 1], transcribedWords, j);

      if (matched > 0) {
        dp[i][j] = dp[i - 1][j - matched];
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
    // 1. Exact match (diagonal, zero cost), over however many spoken words the
    //    written word is said as.
    const matched = i > 0 && j > 0 ? matchedSpokenCount(expectedWords[i - 1], transcribedWords, j) : 0;
    if (matched > 0 && dp[i][j] === dp[i - 1][j - matched]) {
      alignment.unshift({ word: expectedWords[i - 1], status: 'correct' });
      i--;
      j -= matched;
      continue;
    }
    // 2. Substitution — checked BEFORE deletion/insertion to keep i and j in sync on ties
    if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + SUBSTITUTION_MISMATCH_COST) {
      alignment.unshift({
        word: expectedWords[i - 1],
        status: 'wrong',
        spoken: transcribedWords[j - 1],
      });
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
  // `expected` is an array wherever the caller has a per-mushaf-word list to
  // give (expectedWordsFrom), which it must when the result is read by index.
  const expectedWords = Array.isArray(expected) ? expected : splitWords(expected);
  const transcribedWords = Array.isArray(transcribed)
    ? transcribed
    : splitWords(transcribed);
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
