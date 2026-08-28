/**
 * Portion sizing arithmetic.
 *
 * Pure functions, no database and no network, so the numbers can be checked
 * directly. planEngine.js supplies the data and persists the results.
 *
 * The single idea underneath all of it: **a page takes a roughly constant time
 * to recite and an ayah does not.** Pages hold between 1 and 40 ayahs, so the
 * old code, which turned minutes into pages and then pages into ayahs through a
 * flat average of 10.3, was wrong by up to 5x depending where you were. A
 * "30 minute" session came out at 39 minutes in Al-Baqarah (5.5 ayahs a page)
 * and 8 minutes in juz 30 (28.2 a page). Everything here budgets in time, using
 * each ayah's real share of its page.
 */

/** 604 pages across 30 juz. */
export const PAGES_PER_JUZ = 604 / 30;

/**
 * Default until a person's own pace is measured. 2.0 puts a full juz at about
 * 40 minutes, the middle of the 35 to 45 the app is calibrated against.
 */
export const DEFAULT_MINUTES_PER_PAGE = 2.0;

/**
 * Share of a session that is reciting rather than quizzing, used only for
 * planning-level estimates (the onboarding recommendation and the interval
 * ceiling). The actual daily portion does better than this: it counts the real
 * due items instead of assuming a fixed proportion.
 */
const RECITATION_SHARE = 0.75;

/** Fixed cost per quiz item beyond reciting it: prompt, recall, tap. */
const QUIZ_OVERHEAD_SECONDS = 5;

/**
 * Time to allow for the post-session quiz, per page of the portion. It cannot
 * be counted in advance because it is built from mistakes not yet made, so it
 * is an allowance rather than a measurement. Set at roughly one mistake per
 * page, which is the healthy rate under the "more than 2 per page halves it"
 * rule, and costed at an average-length ayah.
 */
const POST_QUIZ_MINUTES_PER_PAGE = (1 / 10.3) * DEFAULT_MINUTES_PER_PAGE
  + QUIZ_OVERHEAD_SECONDS / 60;

/** Never recommend a session too short to be a habit. */
export const MIN_SESSION_MINUTES = 15;

/** A complete round of everything memorised, in days. Dawrah means a round. */
export const CYCLE_DAYS = 30;

/** Bounds on how far a juz interval may stretch. */
export const CEILING_MIN_DAYS = 7;
export const CEILING_MAX_DAYS = 30;

const mpp = (v) => (v && v > 0 ? v : DEFAULT_MINUTES_PER_PAGE);

/** Pages a day needed to get round `juzCount` juz once every CYCLE_DAYS. */
export function pagesPerDayNeeded(juzCount) {
  return (juzCount * PAGES_PER_JUZ) / CYCLE_DAYS;
}

/** Pages a day this session length buys, at planning-level accuracy. */
export function dailyCapacityPages(sessionMinutes, minutesPerPage) {
  return (sessionMinutes * RECITATION_SHARE) / mpp(minutesPerPage);
}

/**
 * Session length to suggest at onboarding for someone with `juzCount` juz.
 * Rounded **up** to the nearest 5: too much time is a day that ends early,
 * too little is a backlog that never clears.
 *
 * 1 to 8 juz gets 15 minutes, 15 juz gets 30, all 30 juz gets 55.
 */
export function recommendedSessionMinutes(juzCount, minutesPerPage) {
  const recitation = pagesPerDayNeeded(juzCount) * mpp(minutesPerPage);
  const total = recitation / RECITATION_SHARE;
  return Math.max(MIN_SESSION_MINUTES, Math.ceil(total / 5) * 5);
}

/**
 * How far a juz interval may stretch: however long one complete round takes at
 * this person's pace, never past 30 days and never under 7.
 *
 * A flat 30 would be right for a hafiz and wrong for everyone else. Someone
 * with 2 juz finishes a round in a week, so a 30-day ceiling leaves them idle
 * 23 days out of 30. This is the same arithmetic as the recommendation above,
 * run backwards, so the two can never disagree.
 */
export function intervalCeilingDays(juzCount, sessionMinutes, minutesPerPage) {
  const capacity = dailyCapacityPages(sessionMinutes, minutesPerPage);
  if (!(capacity > 0)) return CEILING_MAX_DAYS;
  const roundDays = Math.round((juzCount * PAGES_PER_JUZ) / capacity);
  return Math.min(CEILING_MAX_DAYS, Math.max(CEILING_MIN_DAYS, roundDays));
}

/** Minutes one quiz item costs: reciting the ayah, plus fixed overhead. */
export function quizItemMinutes(pageShare, minutesPerPage) {
  return pageShare * mpp(minutesPerPage) + QUIZ_OVERHEAD_SECONDS / 60;
}

/** Minutes a whole quiz costs, from the ayahs actually due. */
export function quizMinutes(items, minutesPerPage) {
  return (items ?? []).reduce(
    (sum, it) => sum + quizItemMinutes(it.pageShare ?? 1 / 10.3, minutesPerPage),
    0
  );
}

/**
 * Allowance for the post-session quiz, given how many pages were recited.
 *
 * Exported so the Today screen can show the same total the budget was built
 * from. Reading it back out of recitationBudgetMinutes() would mean inverting
 * that arithmetic in a second place, which is how two numbers drift apart.
 */
export function postSessionQuizMinutes(pages) {
  return Math.max(0, pages ?? 0) * POST_QUIZ_MINUTES_PER_PAGE;
}

/**
 * What today actually costs, end to end: the due quiz, the portion, and the
 * allowance for the quiz the portion will generate.
 *
 * This is the number shown as "Today: about 35 minutes". It is deliberately the
 * sum of the three real parts rather than the session length the person chose,
 * because the portion is what fits in the time left after the quiz, and on a
 * light day that is less than they asked for.
 */
export function sessionEstimateMinutes(dueQuizMinutes, recitationMinutes, pages) {
  return (dueQuizMinutes ?? 0) + (recitationMinutes ?? 0) + postSessionQuizMinutes(pages);
}

/**
 * The estimate as it is spoken aloud.
 *
 * Rounded to 5 minutes above ten, because the word in front of it is "about"
 * and a minute-precise figure would claim an accuracy that a measured pace and
 * an allowance for mistakes not yet made do not have.
 *
 * Below ten it rounds to the minute instead. A quiz-only day is costed from the
 * ayahs actually due, so three short ayahs come to well under a minute; a flat
 * 5-minute floor would overstate that eightfold, and the whole point of showing
 * the number is that it is honest. Zero means nothing is due, and the caller
 * says nothing rather than putting a time on an empty day.
 */
export function roundedEstimateMinutes(minutes) {
  const total = minutes ?? 0;
  if (total <= 0) return 0;
  if (total < 10) return Math.max(1, Math.round(total));
  return Math.round(total / 5) * 5;
}

/**
 * Minutes left for reciting, once the due quiz has taken its share and an
 * allowance is set aside for the post-session quiz.
 *
 * The quiz is never cut, so it is subtracted first and the portion takes what
 * remains. That is the reverse of the old behaviour, where the portion was
 * sized first and the quiz overran whatever was left.
 */
export function recitationBudgetMinutes(sessionMinutes, dueQuizMinutes, minutesPerPage) {
  const available = Math.max(0, sessionMinutes - (dueQuizMinutes ?? 0));
  return available / (1 + POST_QUIZ_MINUTES_PER_PAGE / mpp(minutesPerPage));
}

/**
 * Walk forward from `startOffset` spending `budgetMinutes`, and report where
 * the portion ends.
 *
 * Never overruns the budget, and always returns at least one ayah so a portion
 * can never be empty even if a single ayah costs more than the whole budget
 * (Al-Baqarah 282 is a full page, about two minutes, on its own).
 *
 * @param {{ pageShare: number }[]} pageMap  every ayah of the juz, offset i at index i-1
 * @param {number} startOffset               1-based juz-relative offset
 * @returns {{ endOffset: number, minutes: number, pages: number }}
 */
export function resolvePortionEnd(pageMap, startOffset, budgetMinutes, minutesPerPage) {
  const perPage = mpp(minutesPerPage);
  let minutes = 0;
  let pages = 0;
  let endOffset = startOffset;

  for (let offset = startOffset; offset <= pageMap.length; offset += 1) {
    const entry = pageMap[offset - 1];
    if (!entry) break;
    const cost = entry.pageShare * perPage;
    // The `minutes > 0` guard is what guarantees at least one ayah.
    if (minutes > 0 && minutes + cost > budgetMinutes) break;
    minutes += cost;
    pages += entry.pageShare;
    endOffset = offset;
  }

  return { endOffset, minutes, pages };
}

/** Pages a portion covers, used by the mistakes-per-page rule. */
export function portionPages(pageMap, startOffset, endOffset) {
  let pages = 0;
  for (let offset = startOffset; offset <= endOffset; offset += 1) {
    const entry = pageMap[offset - 1];
    if (entry) pages += entry.pageShare;
  }
  return pages;
}

/**
 * Mistakes per page above which a session counts as having gone badly.
 * Judged on that session alone, not a running average.
 */
export const MISTAKES_PER_PAGE_LIMIT = 2;

/** Shortest a juz interval may become, however badly a pass goes. */
export const FLOOR_DAYS = 2;

/**
 * The interval after a juz is completed for the first time. There is no gap yet
 * to multiply, so the mistake count picks an absolute number.
 */
const FIRST_PASS_DAYS = [[1, 21], [3, 14], [5, 7], [9, 3], [Infinity, 2]];

/**
 * Every pass after the first multiplies the gap the juz already had. This is
 * the mechanism Anki runs: performance on this review decides what to multiply
 * the previous interval by. `null` means collapse to the floor rather than
 * multiply.
 */
const INTERVAL_MULTIPLIER = [[1, 2], [3, 1.5], [5, 1], [9, 0.5], [Infinity, null]];

function pick(table, mistakes) {
  for (const [limit, value] of table) {
    if (mistakes <= limit) return value;
  }
  return table[table.length - 1][1];
}

/**
 * True when a session went badly enough to halve the next one.
 * A portion of zero pages cannot fail, which guards against dividing by zero.
 */
export function exceedsMistakeLimit(mistakes, pages) {
  if (!(pages > 0)) return false;
  return mistakes / pages > MISTAKES_PER_PAGE_LIMIT;
}

/**
 * How long until a completed juz comes back.
 *
 * @param {number|null} currentIntervalDays  null on the first completed pass
 * @param {number} mistakes                  this pass only; the counter resets each visit
 * @param {number} ceilingDays               from intervalCeilingDays()
 */
export function nextIntervalDays(currentIntervalDays, mistakes, ceilingDays) {
  const ceiling = Math.max(FLOOR_DAYS, ceilingDays ?? CEILING_MAX_DAYS);

  if (currentIntervalDays == null) {
    return Math.min(pick(FIRST_PASS_DAYS, mistakes), ceiling);
  }

  const factor = pick(INTERVAL_MULTIPLIER, mistakes);
  if (factor == null) return FLOOR_DAYS;

  const grown = Math.round(currentIntervalDays * factor);
  return Math.min(Math.max(grown, FLOOR_DAYS), ceiling);
}

/**
 * Sessions of measured pace needed before the default is replaced.
 *
 * Someone's first sessions are them learning the app, not reciting naturally:
 * finding the buttons, discovering what Reveal does, working out what the
 * highlighting means. Calibrating on that would hand them a portion sized for a
 * beginner they stop being within a week.
 */
export const PACE_SESSIONS_REQUIRED = 5;

/**
 * Plausible bounds on minutes per page. Anything outside is thrown away rather
 * than averaged in.
 *
 * This is wall-clock time, so it includes every pause: a knock at the door, a
 * phone call, putting the phone down to think. The 90-second silence cutoff
 * bounds each individual gap but the time still counts. Rather than model all
 * that, sessions that imply an implausible pace are simply not evidence.
 */
const MIN_PLAUSIBLE_MPP = 0.75;
const MAX_PLAUSIBLE_MPP = 6.0;

/** Minutes per page implied by one session, or null if it is not usable. */
export function paceFromSession(recitationSeconds, pages) {
  if (!(recitationSeconds > 0) || !(pages > 0)) return null;
  const mpp = recitationSeconds / 60 / pages;
  if (mpp < MIN_PLAUSIBLE_MPP || mpp > MAX_PLAUSIBLE_MPP) return null;
  return mpp;
}

/**
 * The pace to store, given every usable measurement so far. Null until there
 * are enough to be worth trusting.
 */
export function averagePace(paces) {
  const usable = (paces ?? []).filter((p) => p != null);
  if (usable.length < PACE_SESSIONS_REQUIRED) return null;
  return usable.reduce((a, b) => a + b, 0) / usable.length;
}
