import { normalizeArabic } from './arabicUtils';

/**
 * Live word-by-word judging of an in-progress recitation.
 *
 * The live transcript frontier is unstable — the STT model revises its last
 * couple of words as more audio arrives — so only words at least
 * STABILITY_LAG behind the frontier are judged. Alignment is semi-global:
 * the spoken words must all be consumed, but the expected ayah may end
 * anywhere (the reciter simply hasn't finished it yet), so the unspoken tail
 * is never penalised.
 *
 * The end-of-ayah full diff (wordDiff in arabicUtils) remains the source of
 * truth for the tier state machine and DB writes; this module only provides
 * early mid-ayah feedback.
 */

const STABILITY_LAG = 2;
// Expected-word gap (word not spoken at all): lower cost — missing words at
// end of stable region are fine (reciter hasn't finished yet).
const GAP_EXPECTED_COST = 1;
// Spoken-word gap (extra spoken word, stutter, or filler): equal to
// substitution so the DP prefers SUBSTITUTION over treating a wrong word as
// a free insertion. This prevents a wrong word being silently absorbed.
const GAP_SPOKEN_COST = 2;
const SUBSTITUTION_MISMATCH_COST = 2;

function splitWords(text) {
  return text.split(/\s+/).filter((w) => w.length > 0);
}

/**
 * Align all spoken words against a free-ended prefix of the expected words.
 *
 * @param {string[]} expectedWords normalized expected ayah words
 * @param {string[]} spokenWords normalized stable spoken words
 * @returns {{ statuses: Array<{ index: number, status: 'correct'|'wrong'|'missing', spoken: string|null }> }}
 *   statuses covers expected indices 0..K-1 where K is the best-matching
 *   prefix length; insertions (stutters/fillers) are skipped silently.
 */
export function judgeSpokenPrefix(expectedWords, spokenWords) {
  const m = expectedWords.length;
  const n = spokenWords.length;
  if (m === 0 || n === 0) {
    return { statuses: [] };
  }

  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) dp[i][0] = i * GAP_EXPECTED_COST;
  for (let j = 1; j <= n; j++) dp[0][j] = j * GAP_SPOKEN_COST;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (expectedWords[i - 1] === spokenWords[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
        continue;
      }
      dp[i][j] = Math.min(
        dp[i - 1][j] + GAP_EXPECTED_COST,
        dp[i][j - 1] + GAP_SPOKEN_COST,
        dp[i - 1][j - 1] + SUBSTITUTION_MISMATCH_COST
      );
    }
  }

  // Free end on the expected side: stop at the prefix length with minimal
  // cost. Ties go to the LONGER prefix — this prevents a wrong spoken word
  // from being cheaply absorbed as a free insertion (which would cost the same
  // as a substitution after GAP_SPOKEN_COST=SUBSTITUTION_MISMATCH_COST).
  let bestI = 0;
  for (let i = 1; i <= m; i++) {
    if (dp[i][n] <= dp[bestI][n]) bestI = i;
  }

  const statuses = [];
  let i = bestI;
  let j = n;
  while (i > 0 || j > 0) {
    if (
      i > 0 &&
      j > 0 &&
      expectedWords[i - 1] === spokenWords[j - 1] &&
      dp[i][j] === dp[i - 1][j - 1]
    ) {
      statuses.unshift({ index: i - 1, status: 'correct', spoken: spokenWords[j - 1] });
      i--;
      j--;
      continue;
    }
    if (
      i > 0 &&
      j > 0 &&
      dp[i][j] === dp[i - 1][j - 1] + SUBSTITUTION_MISMATCH_COST
    ) {
      statuses.unshift({ index: i - 1, status: 'wrong', spoken: spokenWords[j - 1] });
      i--;
      j--;
      continue;
    }
    if (i > 0 && dp[i][j] === dp[i - 1][j] + GAP_EXPECTED_COST) {
      statuses.unshift({ index: i - 1, status: 'missing', spoken: null });
      i--;
      continue;
    }
    if (j > 0 && dp[i][j] === dp[i][j - 1] + GAP_SPOKEN_COST) {
      j--; // insertion — stutter/filler, skip silently
      continue;
    }
    break;
  }

  return { statuses };
}

/**
 * Create a judge for one recitation attempt of one ayah.
 *
 * @param {object} opts
 * @param {function(): string[]} opts.getExpectedWords normalized words of the current ayah
 * @param {function(Array<{index:number,status:string,spoken:string|null}>, string): void} opts.onMistake
 *   fired AT MOST ONCE per attempt, with the wrong/missing entries of the
 *   stable region and the live text at the moment of detection
 * @param {function(Array<{index:number,status:string,spoken:string|null}>): void} [opts.onMarksChange]
 *   wrong/missing entries in the stable region (recomputed per update)
 */
export function createLiveJudge({ getExpectedWords, onMistake, onMarksChange }) {
  let fired = false;

  return {
    update(liveText) {
      const spoken = splitWords(normalizeArabic(liveText));
      const stable = spoken.slice(0, Math.max(0, spoken.length - STABILITY_LAG));
      if (stable.length === 0) {
        onMarksChange?.([]);
        return;
      }
      const expected = getExpectedWords();
      if (!expected || expected.length === 0) return;

      const { statuses } = judgeSpokenPrefix(expected, stable);
      const wrongEntries = statuses.filter((s) => s.status !== 'correct');
      // Always update marks so subsequent wrong words keep showing red.
      onMarksChange?.(wrongEntries);

      // Buzz + message only fires once per ayah.
      if (wrongEntries.length > 0 && !fired) {
        fired = true;
        onMistake(wrongEntries, liveText);
      }
    },
    // Run a final pass on the complete ayah text without STABILITY_LAG so
    // substitutions at the end of an ayah (e.g. حساب instead of عذاب) are
    // caught after the ayah completes. Does NOT fire onMistake (buzz already
    // handled by the skip detection in onCommit).
    finalUpdate(liveText) {
      const spoken = splitWords(normalizeArabic(liveText));
      if (spoken.length === 0) return;
      const expected = getExpectedWords();
      if (!expected || expected.length === 0) return;
      const { statuses } = judgeSpokenPrefix(expected, spoken);
      const wrongEntries = statuses.filter((s) => s.status !== 'correct');
      if (wrongEntries.length > 0) {
        onMarksChange?.(wrongEntries);
      }
    },
    reset() {
      fired = false;
      onMarksChange?.([]);
    },
  };
}
