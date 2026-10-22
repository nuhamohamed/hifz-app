import { matchedSpokenCount, matchedSpokenCountAt, normalizeArabic } from './arabicUtils';

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
const GAP_EXPECTED_COST = 10;
// Spoken-word gap (extra spoken word, stutter, or filler): equal to
// substitution so the DP prefers SUBSTITUTION over treating a wrong word as
// a free insertion. This prevents a wrong word being silently absorbed.
// Costs are in tenths so that RETREAD_COST can sit just under a skip, exactly.
const GAP_SPOKEN_COST = 20;
const SUBSTITUTION_MISMATCH_COST = 20;
// A spoken word the ayah has already said before this point: the reciter going
// back over ground they have covered. Cheaper than a substitution, so going
// back never paints the next word red. At equal cost it did, from the first
// re-said word: "A B C D" then "B" tied "B said again" against "B said instead
// of E", ties go to the longer prefix, and E flashed red until enough of the
// repeat arrived to settle it. Going back is the commonest self-correction in
// hifz, so the moment it happens is the worst moment to accuse anyone.
//
// Real mistakes are not hidden by it: a word that was skipped is still
// 'missing', and a wrong word the ayah does not contain still costs the full
// GAP_SPOKEN_COST. The one case delayed is a wrong word that happens to be an
// earlier word of the ayah, which reads as going back until the next word
// shows otherwise. Whether a re-tread hid a slip is still decided at the end
// of the ayah by describeExtraWords.
//
// 9, not 10: a hair under a skipped word (GAP_EXPECTED_COST). An ayah that
// says a word twice makes going back over the first one cost exactly what
// skipping ahead to the second does, and ties go to the longer prefix. In
// Al-Baqarah 144, going back to "قد نرى تقلب وجهك" jumped to the second وجهك
// and showed فول وجهك as recited, when the reciter had said neither. A real
// skip is unaffected: a word the ayah has not used yet has no going-back
// reading to compete with.
const RETREAD_COST = 9;

/**
 * Words of the ayah's opening that must line up before a second run at it is
 * read as a deliberate restart rather than a coincidence.
 *
 * Two is too few — a single echoed word, or the recogniser repeating itself
 * across a partial boundary, would trip it. Three consecutive opening words in
 * the right order is something a reciter only produces by starting over.
 */
const RESTART_MIN_MATCH = 3;

/**
 * Find where the reciter started the current ayah again from its first word.
 *
 * Someone who slips mid-ayah goes back to the top of it far more often than
 * they pick up from the word they fumbled. Judged as one continuous stream,
 * that second run is a disaster: the alignment has to account for the opening
 * being spoken twice, so it paints words red that were recited perfectly well.
 *
 * Returns an index into `spokenWords`, so the caller can judge the live
 * attempt on its own and leave the abandoned one out of it. Scans from the end
 * because if someone started over twice, the last attempt is the live one.
 *
 * Deliberately says nothing about whether a restart *should* be honoured — an
 * ayah that repeats its own opening would match here on a flawless recitation.
 * Callers gate this on a mistake already standing against the ayah.
 *
 * @param {string[]} spokenWords normalized words spoken for this ayah so far
 * @param {string[]} expectedWords normalized expected ayah words
 * @returns {number} index in `spokenWords` where the latest attempt begins,
 *   or 0 when the whole stream is a single attempt
 */
export function findAyahRestart(spokenWords, expectedWords) {
  // Under three words there is no opening distinct enough to recognise, and
  // restarting an ayah that short costs the reciter nothing anyway.
  if (expectedWords.length < RESTART_MIN_MATCH) return 0;

  for (let r = spokenWords.length - RESTART_MIN_MATCH; r >= 1; r--) {
    // How far the opening reaches into the spoken words is not fixed: a word
    // written once may be said as two. Walked rather than indexed, so an ayah
    // opening on one of them (قَالَ يَـٰٓـَٔادَمُ ...) is still recognisable.
    let j = r;
    let matched = true;
    for (let k = 0; k < RESTART_MIN_MATCH; k++) {
      const consumed = matchedSpokenCountAt(expectedWords[k], spokenWords, j);
      if (consumed === 0) {
        matched = false;
        break;
      }
      j += consumed;
    }
    if (matched) return r;
  }
  return 0;
}

function splitWords(text) {
  return text.split(/\s+/).filter((w) => w.length > 0);
}

/**
 * Cost table for aligning `spokenWords` against `expectedWords`.
 *
 * dp[i][j] is the cheapest way to explain the first i expected words using the
 * first j spoken words. Both readouts below share it so the live marking and
 * the word reveal can never reach different conclusions about one recitation.
 */
/**
 * earlierTokens[i]: every word, as said, among the first i expected words.
 * Tokens rather than entries because a word written once may be said as two.
 */
function earlierTokenSets(expectedWords) {
  const sets = [new Set()];
  for (const word of expectedWords) {
    const next = new Set(sets[sets.length - 1]);
    for (const token of word.split(' ')) next.add(token);
    sets.push(next);
  }
  return sets;
}

/**
 * What it costs to treat spokenWords[j - 1] as an extra word once i expected
 * words are accounted for. The table and every walk back through it must ask
 * this same question, or a walk loses its way.
 */
function spokenGapCost(earlier, spokenWords, i, j) {
  return earlier[i].has(spokenWords[j - 1]) ? RETREAD_COST : GAP_SPOKEN_COST;
}

function buildDp(expectedWords, spokenWords) {
  const m = expectedWords.length;
  const n = spokenWords.length;
  const earlier = earlierTokenSets(expectedWords);

  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) dp[i][0] = i * GAP_EXPECTED_COST;
  for (let j = 1; j <= n; j++) dp[0][j] = j * GAP_SPOKEN_COST;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      // What a match consumes is asked, not assumed to be one word: an imlaei
      // word spelled as two is one entry here and two words out loud.
      const matched = matchedSpokenCount(expectedWords[i - 1], spokenWords, j);
      // A match is not always the cheapest reading, so it competes with the
      // rest rather than being taken on sight. Taken on sight, it made going
      // back over an ayah's opening expensive: in Al-Baqarah 2, "ذلك الكتاب لا"
      // said twice matched the second لا to the first at a cost of 6, when
      // reading it as a re-said word costs 3, and ريب went red.
      dp[i][j] = Math.min(
        matched > 0 ? dp[i - 1][j - matched] : Infinity,
        dp[i - 1][j] + GAP_EXPECTED_COST,
        dp[i][j - 1] + spokenGapCost(earlier, spokenWords, i, j),
        dp[i - 1][j - 1] + SUBSTITUTION_MISMATCH_COST
      );
    }
  }

  return dp;
}

/**
 * Walk the table back from (startI, startJ), labelling every expected word the
 * path crosses. Insertions consume a spoken word without labelling anything:
 * a stutter, a filler, or the opening of the next ayah said in the same breath.
 */
function traceback(dp, expectedWords, spokenWords, startI, startJ) {
  const earlier = earlierTokenSets(expectedWords);
  const statuses = [];
  let i = startI;
  let j = startJ;

  while (i > 0 || j > 0) {
    const matched = i > 0 && j > 0 ? matchedSpokenCount(expectedWords[i - 1], spokenWords, j) : 0;
    if (matched > 0 && dp[i][j] === dp[i - 1][j - matched]) {
      statuses.unshift({
        index: i - 1,
        status: 'correct',
        spoken: spokenWords.slice(j - matched, j).join(' '),
      });
      i--;
      j -= matched;
      continue;
    }
    // Substitution before deletion/insertion, so i and j stay in step on ties.
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
    if (j > 0 && dp[i][j] === dp[i][j - 1] + spokenGapCost(earlier, spokenWords, i, j)) {
      j--; // insertion — stutter/filler, skip silently
      continue;
    }
    break;
  }

  return statuses;
}

/**
 * Does this alignment reach the end of the ayah only by hearing a stretch of
 * the ayah a second time?
 *
 * Going back a few words to repair a slip is the commonest self-correction in
 * hifz, and it hands the aligner a stretch of the ayah spoken twice. Because
 * the Qur'an repeats its own vocabulary, that repair run can land on the ayah's
 * closing words at a cost no worse than reading it as the re-tread it is, and
 * the tie-break that prefers the longer prefix then picks the reading that says
 * the ayah is over. Al-Baqarah 26 is the case that surfaced this: skip
 * "يضل به", carry on to the second "كثيرا", then go back for it, and the repair
 * "يضل به كثيرا ويهدي" is read as the ayah's last four words. The ayah is
 * declared finished eight words early, everything still to be said is charged
 * to the next ayah, and both come back red.
 *
 * The tell is not that the closing words were got wrong. It is that the words
 * standing in for them are a run the ayah already contains, in that order,
 * somewhere else. Saying "كثيرا ويهدي" where "الا الفسقين" belongs is not two
 * mistakes that happen to sound Qur'anic, it is a phrase of this ayah arriving
 * for the second time. Two unrelated wrong words at the end are just two wrong
 * words, and the ayah is over.
 *
 * Hence all three conditions. A lone substitution is always a substitution, so
 * a run of one is never a re-tread: a wrong final word on a correctly recited
 * one before it (حساب for عذاب) still ends the ayah, and must, or the reciter
 * would be stranded on it. A word the ayah never contained breaks the run, so
 * fumbling the last two words is still an ending. Only a verbatim phrase of the
 * ayah, in place of its own ending, is read as doubling back.
 *
 * @param {string[]} expectedWords normalized expected ayah words
 * @param {Array<{index:number,status:string,spoken:string|null}>} statuses
 *   a traceback covering the whole ayah (one entry per expected index)
 * @returns {boolean} true when the ending is a re-tread rather than an ending
 */
function endsOnRetread(expectedWords, statuses) {
  const m = expectedWords.length;
  // Nothing to double back over, so nothing to mistake for doubling back.
  if (m < 2 || statuses.length !== m) return false;

  // The run of closing words the alignment was unhappy with.
  let runLength = 0;
  while (runLength < m && statuses[m - 1 - runLength].status !== 'correct') runLength++;
  if (runLength < 2) return false;

  const run = [];
  for (let i = m - runLength; i < m; i++) {
    // A word not said at all leaves a hole, and a re-tread has no holes in it.
    if (statuses[i].status !== 'wrong') return false;
    run.push(statuses[i].spoken);
  }

  // Does the ayah say exactly that, in that order, somewhere else? It can only
  // be somewhere else: these words differ from the ones they were put against.
  //
  // Asked of the ayah's words as they are said, not as they are written, since
  // that is what the run is made of. A written word said as two would match
  // nothing at all otherwise, and every re-tread across one would be read as
  // the ayah ending early.
  const expectedTokens = expectedWords.flatMap((word) => word.split(' '));
  const runTokens = run.flatMap((word) => word.split(' '));
  for (let start = 0; start + runTokens.length <= expectedTokens.length; start++) {
    let found = true;
    for (let k = 0; k < runTokens.length; k++) {
      if (expectedTokens[start + k] !== runTokens[k]) {
        found = false;
        break;
      }
    }
    if (found) return true;
  }

  return false;
}

/**
 * The prefix of the ayah this recitation is best explained as.
 *
 * Ties go to the LONGER prefix, which prevents a wrong spoken word from being
 * cheaply absorbed as a free insertion (that would cost the same as a
 * substitution, since GAP_SPOKEN_COST=SUBSTITUTION_MISMATCH_COST). The one
 * exception is a longer prefix that covers the whole ayah and only reaches the
 * end by re-hearing part of it (see endsOnRetread), where the best prefix
 * stopping short of the end is taken instead.
 *
 * Shared by every readout in this module so the live marking, the word reveal
 * and the end-of-ayah verdict can never reach different conclusions about one
 * recitation.
 */
function bestPrefix(dp, expectedWords, spokenWords) {
  const m = expectedWords.length;
  const n = spokenWords.length;

  let bestI = 0;
  for (let i = 1; i <= m; i++) {
    if (dp[i][n] <= dp[bestI][n]) bestI = i;
  }

  if (bestI === m && endsOnRetread(expectedWords, traceback(dp, expectedWords, spokenWords, m, n))) {
    bestI = 0;
    for (let i = 1; i < m; i++) {
      if (dp[i][n] <= dp[bestI][n]) bestI = i;
    }
  }

  return bestI;
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

  const dp = buildDp(expectedWords, spokenWords);

  // Free end on the expected side: stop where bestPrefix says the reciter has
  // got to.
  const bestI = bestPrefix(dp, expectedWords, spokenWords);

  return { statuses: traceback(dp, expectedWords, spokenWords, bestI, n) };
}

/**
 * How far through the ayah the reciter has got, and what went wrong on the way.
 *
 * This is `judgeSpokenPrefix` answering a second question for the reveal and
 * completion path, which used to run its own greedy matcher instead. That
 * matcher reported a bare position and nothing else, so the screen had to
 * infer mistakes from how far the position jumped — an inference that could
 * not tell a genuine skip from several correct words landing in one commit,
 * and blamed the reciter for both. Returning the per-word verdict removes the
 * guess entirely.
 *
 * `consumedSpoken` is the point where the ayah was finished. Anything after it
 * belongs to the next ayah, started in the same breath, and is handed back to
 * the caller to carry over rather than being forced into this ayah's alignment.
 *
 * @param {string[]} expectedWords normalized expected ayah words
 * @param {string[]} spokenWords normalized words committed for this ayah
 * @returns {{ statuses: Array<{index:number,status:'correct'|'wrong'|'missing',spoken:string|null}>,
 *   matchedCount: number, consumedSpoken: number, complete: boolean }}
 */
export function alignAyahProgress(expectedWords, spokenWords) {
  const m = expectedWords.length;
  const n = spokenWords.length;
  if (m === 0 || n === 0) {
    return { statuses: [], matchedCount: 0, consumedSpoken: 0, complete: false };
  }

  const dp = buildDp(expectedWords, spokenWords);

  const bestI = bestPrefix(dp, expectedWords, spokenWords);

  // Still mid-ayah. Every spoken word is accounted for; the unspoken tail of
  // the ayah is not penalised, because the reciter simply has not reached it.
  if (bestI < m) {
    return {
      statuses: traceback(dp, expectedWords, spokenWords, bestI, n),
      matchedCount: bestI,
      consumedSpoken: n,
      complete: false,
    };
  }

  // The whole ayah is accounted for. Find where it finished, so anything said
  // after that can carry over to the next ayah instead of being forced into
  // this one's alignment.
  //
  // Every spoken word still has to be paid for, whether the ayah consumed it
  // or it is left to carry over — hence the trailing GAP_SPOKEN_COST term.
  // Without it, abandoning a word is free, and a wrong FINAL word gets dropped
  // as carry-over (leaving its slot merely 'missing') rather than being named
  // as the substitution it is. Ties go to the smaller j, so words that cost
  // the same either way are carried over rather than swallowed.
  let endJ = n;
  let endCost = dp[m][n];
  for (let j = n - 1; j >= 0; j--) {
    const cost = dp[m][j] + (n - j) * GAP_SPOKEN_COST;
    if (cost <= endCost) {
      endCost = cost;
      endJ = j;
    }
  }

  return {
    statuses: traceback(dp, expectedWords, spokenWords, m, endJ),
    matchedCount: m,
    consumedSpoken: endJ,
    complete: true,
  };
}

/**
 * Did the reciter actually slip before going back, or were they only re-treading
 * words they had already said correctly?
 *
 * Both look identical to a live judge: words arrive twice and the ayah ends
 * correct either way. The difference is in what the second pass replaced. Going
 * back over "و3 و4 و5" having just said "و3 و4 و5" adds nothing and means
 * nothing. Going back over them having said something else in the middle, or
 * having jumped a word, is a slip the reciter caught and fixed, and for hifz
 * that belongs on the record even though the ayah finished clean.
 *
 * So every run of words the alignment threw away is examined. A run is innocent
 * only if it is exactly the stretch of the ayah leading up to where the reciter
 * picked up again — a plain re-tread. Anything else in there (a word not in the
 * ayah, or one from further ahead, which is what a skipped word looks like)
 * is evidence of the slip.
 *
 * @param {string[]} expectedWords normalized expected ayah words
 * @param {string[]} spokenWords normalized words spoken for this ayah
 * @returns {boolean} true when something was genuinely got wrong along the way
 */
export function hasSelfCorrectedSlip(expectedWords, spokenWords) {
  return describeExtraWords(expectedWords, spokenWords).slipped;
}

/**
 * What the alignment had to throw away to read this recitation as the ayah.
 *
 * `slipped` is what hasSelfCorrectedSlip reports: something in the discarded
 * words was more than a re-tread, so a mistake happened on the way.
 *
 * `discarded` is the question that one cannot answer, and the end of an ayah
 * needs both. A mark made live and not confirmed by the final text is only
 * explainable as a re-tread artefact if there was something re-trodden. When
 * nothing was discarded at all, the recitation ran straight through, and a
 * live mark standing over it is evidence of a word the recogniser heard
 * differently at the time and then tidied up, which is a real mistake and the
 * reciter's to keep. Both cases report slipped: false, which is why asking
 * that alone threw away the second one.
 *
 * @returns {{discarded: boolean, slipped: boolean}}
 */
/**
 * Is `run` nothing but the end of `behind` said again, any number of times?
 *
 * Stopping on a word and saying it again, or going back twice in a row, puts
 * several copies side by side: "ذلك ذلك ذلك", or "لا ريب لا ريب". Each copy is
 * a stretch ending where the reciter had got to. Matching the whole run
 * against a single stretch read the second repeat as a slip.
 */
function isRepeatsOfBehind(run, behind) {
  // ok[k]: run[0..k) splits into copies of stretches ending at `behind`'s end.
  const ok = [true];
  for (let k = 1; k <= run.length; k++) {
    ok[k] = false;
    for (let len = 1; len <= Math.min(k, behind.length) && !ok[k]; len++) {
      if (!ok[k - len]) continue;
      let same = true;
      for (let t = 0; t < len; t++) {
        if (run[k - len + t] !== behind[behind.length - len + t]) {
          same = false;
          break;
        }
      }
      ok[k] = same;
    }
  }
  return run.length > 0 && ok[run.length];
}

export function describeExtraWords(expectedWords, spokenWords) {
  const m = expectedWords.length;
  const n = spokenWords.length;
  if (m === 0 || n === 0) return { discarded: false, slipped: false };

  const dp = buildDp(expectedWords, spokenWords);
  const earlier = earlierTokenSets(expectedWords);

  const bestI = bestPrefix(dp, expectedWords, spokenWords);

  // Walk the same path the traceback takes, collecting the discarded words by
  // the point in the ayah the reciter resumed at.
  const runs = new Map();
  let i = bestI;
  let j = n;
  while (i > 0 || j > 0) {
    const matched = i > 0 && j > 0 ? matchedSpokenCount(expectedWords[i - 1], spokenWords, j) : 0;
    if (matched > 0 && dp[i][j] === dp[i - 1][j - matched]) {
      i--;
      j -= matched;
      continue;
    }
    if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + SUBSTITUTION_MISMATCH_COST) {
      i--;
      j--;
      continue;
    }
    if (i > 0 && dp[i][j] === dp[i - 1][j] + GAP_EXPECTED_COST) {
      i--;
      continue;
    }
    if (j > 0 && dp[i][j] === dp[i][j - 1] + spokenGapCost(earlier, spokenWords, i, j)) {
      const run = runs.get(i) ?? [];
      run.unshift(spokenWords[j - 1]); // walking backwards, so keep spoken order
      runs.set(i, run);
      j--;
      continue;
    }
    break;
  }

  // A re-tread is the reciter saying again, in order, the very words the
  // alignment goes on to match from this point. Anything else in the run — a
  // word not in the ayah, or one from further ahead, which is what a skipped
  // word looks like on the way past — is the slip.
  let slipped = false;
  for (const [resumeAt, run] of runs) {
    // The run is spoken words, so the ayah is read as spoken words too: an
    // entry the reciter says as two contributes two here.
    //
    // Either copy of a re-trodden stretch can be the one discarded. With
    // re-said words cheaper than wrong ones (RETREAD_COST) it is usually the
    // second, sitting just after the stretch it repeats, so the run is checked
    // against the words behind the resume point as well as those ahead of it.
    const ahead = expectedWords.slice(resumeAt).flatMap((word) => word.split(' '));
    const behind = expectedWords.slice(0, resumeAt).flatMap((word) => word.split(' '));
    const repeatsAhead =
      run.length <= ahead.length && run.every((word, k) => word === ahead[k]);
    const isPlainRetread = repeatsAhead || isRepeatsOfBehind(run, behind);
    if (!isPlainRetread) slipped = true;
  }

  return { discarded: runs.size > 0, slipped };
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
    // handled in onCommit).
    //
    // Reports its verdict even when that verdict is "nothing wrong", which is
    // the whole point of running it. Mid-ayah marks are guesses made while the
    // recitation was still arriving, and going back a few words reliably
    // produces one: the same word arrives twice and, until enough follows to
    // explain why, the cheapest reading is that some later word was said
    // wrongly. By the end there is no ambiguity left. Staying silent on a
    // clean result left those guesses standing over a recitation this pass had
    // just established was correct.
    finalUpdate(liveText) {
      const spoken = splitWords(normalizeArabic(liveText));
      if (spoken.length === 0) return;
      const expected = getExpectedWords();
      if (!expected || expected.length === 0) return;
      const { statuses } = judgeSpokenPrefix(expected, spoken);
      onMarksChange?.(statuses.filter((s) => s.status !== 'correct'));
    },
    reset() {
      fired = false;
      onMarksChange?.([]);
    },
  };
}
