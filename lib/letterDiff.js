/**
 * Character-level diff within one Arabic word.
 *
 * The "display word" is Uthmanic script with full tashkeel. The "spoken word"
 * is the STT output after normalizeArabic (diacritics stripped, letter variants
 * unified). We align their phonetic skeletons via Levenshtein and map the
 * wrong/correct status back to the display segments (base letter + diacritics).
 *
 * Superscript alef (U+0670) is treated as a separate phonetic unit representing
 * alef — critical for Uthmanic words like the one spelled with ـٰ where the
 * hidden alef appears visually as tatweel+superscript-alef but the STT spells
 * it with a regular alef letter.
 */

// U+0670 Arabic letter superscript alef — treated as phonetic alef, not diacritic
const SUPERSCRIPT_ALEF_CP = 0x0670;
// U+0640 Kashida / tatweel — visual extender, no phonetic value
const TATWEEL_CP = 0x0640;

// Combining diacritics that attach to the preceding base letter with no independent sound:
//   U+0610-U+061A  Arabic extended marks (sign sallahou alayhe etc.)
//   U+064B-U+065F  Arabic tashkeel (fathatan … wavy hamza below)
//   U+06D6-U+06ED  Quranic pause / annotation marks
// Does NOT include U+0640 (handled as TATWEEL_CP) or U+0670 (handled as SUPERSCRIPT_ALEF_CP).
function isDiacritic(cp) {
  return (
    (cp >= 0x0610 && cp <= 0x061a) ||
    (cp >= 0x064b && cp <= 0x065f) ||
    (cp >= 0x06d6 && cp <= 0x06ed)
  );
}

// Any Arabic Unicode codepoint — catches base letters once diacritics are filtered
function isArabic(cp) {
  return (cp >= 0x0600 && cp <= 0x06ff) || (cp >= 0x0750 && cp <= 0x077f);
}

function normalizeChar(ch) {
  const cp = ch.codePointAt(0);
  // Hamza variants: U+0623 أ, U+0625 إ, U+0622 آ, U+0671 ٱ → ا
  if (cp === 0x0623 || cp === 0x0625 || cp === 0x0622 || cp === 0x0671) return 'ا';
  // Alef maqsura: ى → ا (word-level context exceptions already handled by normalizeArabic)
  if (cp === 0x0649) return 'ا';
  // Taa marbuta: ة → ه
  if (cp === 0x0629) return 'ه';
  // Waw hamza: ؤ → و
  if (cp === 0x0624) return 'و';
  // Ya hamza: ئ → ي
  if (cp === 0x0626) return 'ي';
  return ch;
}

/**
 * Split a Uthmanic display word into phonetic segments for Levenshtein alignment.
 * Each segment: { display: string, norm: string }
 * Superscript alef absorbs any immediately preceding tatweel (ـٰ = one visual unit).
 */
function segmentDisplayWord(displayWord) {
  const segments = [];
  let current = null;

  for (const ch of displayWord) {
    const cp = ch.codePointAt(0);

    if (cp === SUPERSCRIPT_ALEF_CP) {
      // Independent phonetic alef. Absorb a trailing tatweel from the preceding
      // segment so that ـٰ highlights as one visual unit.
      let prefix = '';
      if (current && current.display.endsWith('ـ')) {
        current.display = current.display.slice(0, -1);
        prefix = 'ـ';
        if (!current.display) current = null;
      }
      if (current) segments.push(current);
      current = { display: prefix + ch, norm: 'ا' }; // ا
    } else if (cp === TATWEEL_CP || isDiacritic(cp)) {
      // Attach to current segment display, no new segment.
      if (current) current.display += ch;
    } else if (isArabic(cp)) {
      // Base Arabic letter — start a new segment.
      if (current) segments.push(current);
      current = { display: ch, norm: normalizeChar(ch) };
    }
    // Non-Arabic chars (spaces, punctuation) — skipped (caller passes one word).
  }
  if (current) segments.push(current);
  return segments;
}

/**
 * Compute per-letter wrong/correct status for one word.
 *
 * @param {string} displayWord      Uthmanic display text (with tashkeel)
 * @param {string|null} spokenNormWord   Normalized spoken word from STT; null = word was missing
 * @returns {{ text: string, wrong: boolean }[]}  Merged runs of same-status display chars
 */
export function computeLetterSegments(displayWord, spokenNormWord) {
  const segs = segmentDisplayWord(displayWord);
  if (segs.length === 0) return [];

  if (spokenNormWord === null) {
    return [{ text: displayWord, wrong: true }];
  }

  const displayNorm = segs.map((s) => s.norm);
  // Keep only Arabic letter codepoints (normalizeArabic already removed diacritics)
  const spoken = Array.from(spokenNormWord).filter((c) => isArabic(c.codePointAt(0)));

  if (spoken.length === 0) {
    return [{ text: displayWord, wrong: true }];
  }

  // Standard Levenshtein DP
  const m = displayNorm.length;
  const n = spoken.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) dp[i][0] = i;
  for (let j = 1; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        displayNorm[i - 1] === spoken[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }

  // Backtrack — mark each display segment wrong or correct
  const wrong = new Array(m).fill(false);
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (
      i > 0 &&
      j > 0 &&
      displayNorm[i - 1] === spoken[j - 1] &&
      dp[i][j] === dp[i - 1][j - 1]
    ) {
      i--; j--; // match
    } else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) {
      wrong[i - 1] = true; // substitution
      i--; j--;
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      wrong[i - 1] = true; // display char not spoken (deletion)
      i--;
    } else if (j > 0) {
      j--; // extra spoken char (insertion), skip
    } else {
      break;
    }
  }

  // Merge consecutive same-status segments for cleaner rendering
  const result = [];
  for (let k = 0; k < segs.length; k++) {
    const w = wrong[k];
    if (result.length > 0 && result[result.length - 1].wrong === w) {
      result[result.length - 1].text += segs[k].display;
    } else {
      result.push({ text: segs[k].display, wrong: w });
    }
  }
  return result;
}
