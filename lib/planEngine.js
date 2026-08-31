import { supabase } from './supabase';
import { addDays, daysBetween, todayString as getTodayDateString } from './dates';
import { getJuzTotalAyahs, JUZ_DATA } from './juzSurahMap';
import { getJuzAyahPages } from './mushafDb';
import { dueQuizCost } from './quizEngine';
import {
  DEFAULT_MINUTES_PER_PAGE,
  averagePace,
  exceedsMistakeLimit,
  intervalCeilingDays,
  nextIntervalDays,
  paceFromSession,
  portionPages,
  recitationBudgetMinutes,
  resolvePortionEnd,
  sessionEstimateMinutes,
} from './portionMath';

// One query per juz, reused for the life of the app. The mushaf never changes,
// so this is a pure lookup: ~150 rows giving each ayah's page and its share of
// that page. Keyed on juz number.
const pageMapCache = new Map();

/**
 * Page data for every ayah of a juz, indexed so that offset n is at [n - 1].
 * @param {import('expo-sqlite').SQLiteDatabase} db
 */
async function loadJuzPageMap(db, juzNumber) {
  if (pageMapCache.has(juzNumber)) {
    return pageMapCache.get(juzNumber);
  }
  const segments = JUZ_DATA[juzNumber - 1]?.surahs ?? [];
  const map = await getJuzAyahPages(db, segments);
  pageMapCache.set(juzNumber, map);
  return map;
}

/**
 * Where today's portion ends, given where it starts.
 *
 * Budgets in minutes against each ayah's real share of a page, rather than
 * counting ayahs. That is what makes "30 minutes" mean the same thing in
 * Al-Baqarah (5.5 ayahs to a page) as in juz 30 (28.2 a page), and it is why
 * a portion crossing a surah boundary is no longer a special case: offsets do
 * not know what a surah is.
 *
 * `dueQuizMinutes` is subtracted first because the quiz is never cut. The
 * portion takes what is left.
 */
async function computePortion(db, juzNumber, startOffset, sessionMinutes, minutesPerPage, dueQuizMinutes, halved) {
  const pageMap = await loadJuzPageMap(db, juzNumber);
  const full = recitationBudgetMinutes(
    sessionMinutes ?? DEFAULT_SESSION_MINUTES,
    dueQuizMinutes ?? 0,
    minutesPerPage ?? DEFAULT_MINUTES_PER_PAGE
  );
  // Two sizes exist and no others. Nothing ever earns a bigger portion, since
  // the minutes they chose are the ceiling, and halving never compounds: a
  // second bad session leaves it at half rather than a quarter. Repeated
  // halving never converges, because mistakes per page is a property of the
  // person rather than of how much they recite.
  const budget = halved ? full / 2 : full;
  return resolvePortionEnd(
    pageMap,
    startOffset,
    budget,
    minutesPerPage ?? DEFAULT_MINUTES_PER_PAGE
  );
}

/** Just the end offset, for the call sites that only persist a range. */
async function computePortionEnd(db, juzNumber, startOffset, sessionMinutes, minutesPerPage, dueQuizMinutes, halved) {
  const { endOffset } = await computePortion(
    db, juzNumber, startOffset, sessionMinutes, minutesPerPage, dueQuizMinutes, halved
  );
  return endOffset;
}

const DEFAULT_SESSION_MINUTES = 30;

// Rows written before the clamp below existed can still run past the end of
// their juz, and callers resolve these offsets with getAyahLocation(), which
// throws when one is out of range. Clamp on read so an already-persisted bad
// row degrades to a short final portion instead of bricking the Today screen.
async function mapScheduledRow(db, row, sessionMinutes, minutesPerPage, dueQuizMinutes, halved) {
  const juzTotal = getJuzTotalAyahs(row.juz_number);
  const portionStartAyah = Math.min(row.portion_start_ayah, juzTotal);
  // The stored end is deliberately ignored. A scheduled row records *where*
  // work resumes; how far it reaches is a property of today, not of the day it
  // was written. Someone who has since dropped from 30 minutes to 15, or who
  // has a heavy quiz due, gets a portion that fits today rather than one sized
  // for the past. It also means rows written by the old ayah-count scheduler
  // resize themselves instead of having to be migrated.
  //
  // `halved` has to be passed in for the same reason. Recomputing without it
  // undid the halving on every scheduled row, which is nearly all of them, so
  // a bad session wrote a halved range that was then thrown away on read.
  const { endOffset, minutes, pages } = await computePortion(
    db,
    row.juz_number,
    portionStartAyah,
    sessionMinutes,
    minutesPerPage,
    dueQuizMinutes,
    halved
  );
  return {
    juzNumber: row.juz_number,
    portionStartAyah,
    portionEndAyah: endOffset,
    recitationMinutes: minutes,
    pages,
    type: row.type,
    scheduledDate: row.scheduled_date,
  };
}

/**
 * Pages in an arbitrary range of a juz.
 *
 * Exported for the Today screen, which has to size a paused session's own
 * portion. A paused session is committed to the range stored on its row, but
 * the screen's portion list is re-sized for today, so the two disagree and the
 * screen cannot use the second to measure the first.
 */
export async function portionPagesFor(db, juzNumber, startOffset, endOffset) {
  const pageMap = await loadJuzPageMap(db, juzNumber);
  return portionPages(pageMap, startOffset, endOffset);
}

/**
 * Days until next full juz review based on cumulative Tier 2 mistakes.
 *
 * @param {number} cumulativeMistakes
 * @returns {number}
 */
export function getNextReviewDate(passMistakes, currentIntervalDays, ceilingDays) {
  return nextIntervalDays(currentIntervalDays ?? null, passMistakes, ceilingDays);
}

/**
 * Re-measures how fast this person recites and stores it, once there is enough
 * evidence to be worth trusting.
 *
 * The app assumed everyone recited at exactly 2.0 minutes a page, and the
 * column meant to hold their real pace had never once been written to. Without
 * it, "30 minutes" is a guess: a fast reciter is short-changed and a slow one
 * is handed a session they cannot finish.
 *
 * Nothing is stored until five plausible sessions exist. Someone's first
 * sessions are them learning the app rather than reciting naturally, and
 * calibrating on those would size their portion for a beginner they stop being
 * within a week.
 *
 * Every completed session is re-measured from scratch rather than kept as a
 * running average, so a session later dismissed as a misflag, or one that turns
 * out implausible, simply stops counting.
 */
async function refreshMeasuredPace(db, userId) {
  const { data: rows, error } = await supabase
    .from('sessions')
    .select('juz_number, portion_start_ayah, portion_end_ayah, recitation_seconds')
    .eq('user_id', userId)
    .eq('status', 'complete')
    // Belt and braces. A quiz-only day never sets recitation_seconds, so the
    // null check below already excludes it, but that is a property of another
    // screen rather than something stated here.
    .eq('type', 'revision')
    .not('recitation_seconds', 'is', null)
    .order('completed_at', { ascending: false })
    .limit(30);

  if (error || !rows?.length) return;

  const paces = [];
  for (const row of rows) {
    const pageMap = await loadJuzPageMap(db, row.juz_number);
    const pages = portionPages(pageMap, row.portion_start_ayah, row.portion_end_ayah);
    paces.push(paceFromSession(row.recitation_seconds, pages));
  }

  const measured = averagePace(paces);
  if (measured == null) return;

  const { error: updateError } = await supabase
    .from('users')
    .update({ avg_minutes_per_page: Number(measured.toFixed(2)) })
    .eq('id', userId);

  if (updateError) {
    console.error('[plan] could not store the measured pace:', updateError.message);
  }
}

/** How many juz this person has in rotation, which sets their interval ceiling. */
async function fetchJuzCount(userId) {
  const { count, error } = await supabase
    .from('juz_progress')
    .select('juz_number', { count: 'exact', head: true })
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
  return count ?? 1;
}

/**
 * Determine today's portion for a user.
 *
 * @param {string} userId
 * @returns {Promise<
 *   | { juzNumber: number, portionStartAyah: number, portionEndAyah: number, type: string, scheduledDate?: string }
 *   | { type: 'quiz_only' }
 * >}
 */
export async function getTodayPortions(db, userId, dueQuizMinutes = 0) {
  const today = getTodayDateString();

  // Fetched first because every branch below sizes its portion from these.
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('session_minutes, avg_minutes_per_page')
    .eq('id', userId)
    .maybeSingle();

  if (userError) {
    throw new Error(userError.message);
  }

  const sessionMinutes = user?.session_minutes ?? DEFAULT_SESSION_MINUTES;
  const minutesPerPage = user?.avg_minutes_per_page ?? DEFAULT_MINUTES_PER_PAGE;

  // A juz already recited today is finished for the day, whichever branch below
  // would otherwise offer it. Without this a first pass, which has no scheduled
  // row for today and is discovered one portion at a time, hands out the next
  // portion the moment a session ends and never reaches "All done for today".
  //
  // Filtered to real recitation. A quiz-only session carries juz 1 in its
  // portion columns as filler, and counting it would retire juz 1 by accident.
  const { data: doneToday, error: doneError } = await supabase
    .from('sessions')
    .select('juz_number')
    .eq('user_id', userId)
    .eq('date', today)
    .eq('status', 'complete')
    .eq('type', 'revision');

  if (doneError) {
    throw new Error(doneError.message);
  }
  const recitedToday = new Set((doneToday ?? []).map((r) => r.juz_number));

  // Oldest first, then lowest juz, then earliest offset within a juz.
  //
  // This used to be newest first, which worked only because a pass had exactly
  // one row outstanding at a time and worked rows were never cleared: picking
  // the newest was how they were stepped over. Now that a completed pass lays
  // out all of its portions at once, newest-first would hand back the *end* of
  // a juz and skip everything before it. Rows are marked done at the end of
  // each session instead, which is what makes oldest-first safe.
  // Mushaf order across juz, oldest first within one. Ordering by juz before
  // date is what lets the grouping below take each juz's oldest row in a
  // single pass.
  const { data: scheduled, error: scheduledError } = await supabase
    .from('scheduled_portions')
    .select('juz_number, portion_start_ayah, portion_end_ayah, type, scheduled_date')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .lte('scheduled_date', today)
    .order('juz_number', { ascending: true })
    .order('scheduled_date', { ascending: true })
    .order('portion_start_ayah', { ascending: true });

  if (scheduledError) {
    throw new Error(scheduledError.message);
  }

  if (scheduled?.length) {
    // One portion per juz, and every juz still due today appears, in mushaf
    // order, rather than one being served while the others stay invisible.
    const dueByJuz = [];
    const seen = new Set();
    for (const row of scheduled) {
      if (seen.has(row.juz_number) || recitedToday.has(row.juz_number)) continue;
      seen.add(row.juz_number);
      dueByJuz.push(row);
    }

    const { data: progressRows } = await supabase
      .from('juz_progress')
      .select('juz_number, portion_halved')
      .eq('user_id', userId)
      .in('juz_number', dueByJuz.map((r) => r.juz_number));
    const halved = new Map(
      (progressRows ?? []).map((r) => [r.juz_number, r.portion_halved === true])
    );

    const portions = [];
    for (let i = 0; i < dueByJuz.length; i += 1) {
      const row = dueByJuz[i];
      portions.push(
        await mapScheduledRow(
          db,
          row,
          sessionMinutes,
          minutesPerPage,
          // The quiz is paid for once, by the first portion of the day. The
          // rest are sized as a normal day's work for their own juz, so the
          // total can exceed the minutes the person chose. That is the settled
          // handling: the overflow is real, they see it before they start, and
          // pausing leaves the rest for tomorrow.
          i === 0 ? dueQuizMinutes : 0,
          halved.get(row.juz_number) === true
        )
      );
    }

    // Everything still pending behind today's list, which is the backlog depth.
    const waiting = scheduled.filter((r) => !dueByJuz.includes(r)).length;
    return { portions, waiting };
  }

  const { data: fullReviewRows, error: fullReviewError } = await supabase
    .from('juz_progress')
    .select('juz_number, portion_halved')
    .eq('user_id', userId)
    .eq('first_pass_complete', true)
    .lte('next_full_review_date', today)
    .not('juz_number', 'in', `(${[...recitedToday, -1].join(',')})`)
    // Oldest due first when several juz are waiting. Simple and predictable,
    // and with intervals anchored to the day a juz finishes, two juz that
    // finished a week apart stay a week apart, so this rarely has to arbitrate.
    .order('next_full_review_date', { ascending: true })
    .order('juz_number', { ascending: true })
    .limit(1);

  if (fullReviewError) {
    throw new Error(fullReviewError.message);
  }

  const fullReview = fullReviewRows?.[0];
  if (fullReview) {
    const portionStartAyah = 1;
    const { endOffset, minutes, pages } = await computePortion(
      db,
      fullReview.juz_number,
      portionStartAyah,
      sessionMinutes,
      minutesPerPage,
      dueQuizMinutes,
      fullReview.portion_halved === true
    );
    return {
      portions: [
        {
          juzNumber: fullReview.juz_number,
          portionStartAyah,
          portionEndAyah: endOffset,
          recitationMinutes: minutes,
          pages,
          type: 'full_juz_review',
        },
      ],
      waiting: 0,
    };
  }

  const { data: inProgressRows, error: inProgressError } = await supabase
    .from('juz_progress')
    .select('juz_number, portion_halved')
    .eq('user_id', userId)
    .eq('first_pass_complete', false)
    // Lowest juz first, so someone who knows juz 1 to 15 works through juz 1,
    // finishes it, then starts juz 2. Never fifteen at once.
    .order('juz_number', { ascending: true })
    .limit(1);

  if (inProgressError) {
    throw new Error(inProgressError.message);
  }

  // A juz with a row already booked is the schedule's business, even if that
  // row is in the future. Improvising a portion from the last session as well
  // would hand out today's work for a juz that has deliberately been set to
  // begin tomorrow.
  const { count: booked, error: bookedError } = await supabase
    .from('scheduled_portions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'pending')
    .eq('juz_number', inProgressRows?.[0]?.juz_number ?? -1);

  if (bookedError) {
    throw new Error(bookedError.message);
  }

  const inProgress = inProgressRows?.[0];
  if (inProgress && !recitedToday.has(inProgress.juz_number) && (booked ?? 0) === 0) {
    const portionStartAyah = await getNextPortionStartAyah(
      userId,
      inProgress.juz_number
    );
    const juzTotal = getJuzTotalAyahs(inProgress.juz_number);
    // Past the end of the juz means the pass is finished. Clamped rather than
    // allowed through, because getAyahLocation() throws on an out-of-range
    // offset and does so during render, which blanks the screen.
    if (portionStartAyah > juzTotal) {
      return { portions: [], waiting: 0 };
    }
    const { endOffset, minutes, pages } = await computePortion(
      db,
      inProgress.juz_number,
      portionStartAyah,
      sessionMinutes,
      minutesPerPage,
      dueQuizMinutes,
      inProgress.portion_halved === true
    );
    return {
      portions: [
        {
          juzNumber: inProgress.juz_number,
          portionStartAyah,
          portionEndAyah: endOffset,
          recitationMinutes: minutes,
          pages,
          type: 'revision',
        },
      ],
      waiting: 0,
    };
  }

  // No portions at all: a quiz-only day.
  return { portions: [], waiting: 0 };
}

async function getNextPortionStartAyah(userId, juzNumber) {
  const { data: lastSession, error } = await supabase
    .from('sessions')
    .select('portion_end_ayah')
    .eq('user_id', userId)
    .eq('juz_number', juzNumber)
    .eq('status', 'complete')
    // Real recitation only, and this is the worst place the filler bit.
    //
    // A quiz-only day is stored with juz 1 and portion 1-1, and it is the most
    // recently completed session on the day it happens. Without this filter,
    // someone who had recited juz 1 up to ayah 60 and then had a quiz-only day
    // came back to a first pass restarting at ayah 2: portion_end_ayah + 1
    // where portion_end_ayah was the filler 1. Fifty-eight ayahs of progress
    // discarded, silently, and again at every quiz-only day after it.
    .eq('type', 'revision')
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (lastSession?.portion_end_ayah != null) {
    return lastSession.portion_end_ayah + 1;
  }

  return 1;
}

// Every mistake counts equally. This used to filter tier = 2, which was a
// far rarer event, so the thresholds it fed were calibrated against a number
// perhaps a fifth the size of the one they now see.
async function fetchMistakeCountForSession(sessionId) {
  const { count, error } = await supabase
    .from('mistakes')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId);

  if (error) {
    throw new Error(error.message);
  }

  return count ?? 0;
}

async function getOrCreateJuzProgress(userId, juzNumber) {
  const { data: existing, error: fetchError } = await supabase
    .from('juz_progress')
    .select('*')
    .eq('user_id', userId)
    .eq('juz_number', juzNumber)
    .maybeSingle();

  if (fetchError) {
    throw new Error(fetchError.message);
  }

  if (existing) {
    return existing;
  }

  const { data: created, error: insertError } = await supabase
    .from('juz_progress')
    .insert({
      user_id: userId,
      juz_number: juzNumber,
      pass_mistakes: 0,
      first_pass_complete: false,
      portion_halved: false,
      repeat_used: false,
    })
    .select()
    .single();

  if (insertError) {
    throw new Error(insertError.message);
  }

  return created;
}

/**
 * Book the very first portion for tomorrow instead of today.
 *
 * Chosen at the end of onboarding by someone who does not want to start this
 * minute. Writing a real row rather than a flag means the rest of the app needs
 * to know nothing about the choice: today simply has nothing due, and tomorrow
 * behaves like any other scheduled day.
 */
export async function scheduleFirstPortionForTomorrow(db, userId) {
  const { data: user } = await supabase
    .from('users')
    .select('session_minutes, avg_minutes_per_page')
    .eq('id', userId)
    .maybeSingle();

  const { data: juzRows, error: juzError } = await supabase
    .from('juz_progress')
    .select('juz_number')
    .eq('user_id', userId)
    .eq('first_pass_complete', false)
    .order('juz_number', { ascending: true })
    .limit(1);

  if (juzError) throw new Error(juzError.message);
  const juzNumber = juzRows?.[0]?.juz_number;
  if (juzNumber == null) return;

  const { error: insertError } = await supabase.from('scheduled_portions').insert({
    user_id: userId,
    scheduled_date: addDays(getTodayDateString(), 1),
    juz_number: juzNumber,
    portion_start_ayah: 1,
    // Advisory only: the read path resizes every portion to the day it lands on.
    portion_end_ayah: await computePortionEnd(
      db,
      juzNumber,
      1,
      user?.session_minutes ?? DEFAULT_SESSION_MINUTES,
      user?.avg_minutes_per_page ?? DEFAULT_MINUTES_PER_PAGE,
      0,
      false
    ),
    type: 'revision',
  });

  if (insertError) throw new Error(insertError.message);
}

/**
 * Seed juz_progress rows from memorized_portions after onboarding.
 * Creates one row per distinct juz the user has memorized, skipping any that already exist.
 */
export async function seedJuzProgressFromMemorized(userId) {
  const { data: portions, error: portionsError } = await supabase
    .from('memorized_portions')
    .select('juz_number')
    .eq('user_id', userId);

  if (portionsError) {
    throw new Error(portionsError.message);
  }

  const juzNumbers = [...new Set((portions ?? []).map((r) => r.juz_number))];

  for (const juzNumber of juzNumbers) {
    await getOrCreateJuzProgress(userId, juzNumber);
  }
}

/**
 * Every complete session of the pass that has just finished, oldest first.
 *
 * A pass always starts at offset 1, so walking back from the newest session to
 * the first one that started there recovers the whole pass without a column to
 * mark where it began.
 *
 * @param {string} userId
 * @param {number} juzNumber
 */
async function fetchPassSessions(userId, juzNumber) {
  const { data: rows, error } = await supabase
    .from('sessions')
    .select('date, portion_start_ayah, portion_end_ayah')
    .eq('user_id', userId)
    .eq('juz_number', juzNumber)
    .eq('status', 'complete')
    // Real recitation only.
    //
    // A quiz-only day carries juz 1 and portion 1-1 in its columns as filler,
    // because those are NOT NULL and nothing downstream was meant to read them.
    // This read them. The walk-back below stops at the first row starting at
    // offset 1, on the reasoning that a pass always begins there, and a
    // quiz-only row satisfies that test without being part of any pass.
    //
    // So a quiz-only day taken in the middle of juz 1 ended the pass early:
    // every portion recited before it was dropped from the replay, the filler
    // 1-1 row was kept as though it were a real portion, and scheduleCompletedPass
    // anchored its date shift on that day. The next round of the juz came back
    // missing the ground covered before the quiz-only day, and nothing said so.
    .eq('type', 'revision')
    .order('date', { ascending: false })
    .order('completed_at', { ascending: false })
    .limit(120);

  if (error) {
    throw new Error(error.message);
  }
  if (!rows?.length) return [];

  const pass = [];
  for (const row of rows) {
    pass.push(row);
    if (row.portion_start_ayah <= 1) break;
  }
  return pass.reverse();
}

/**
 * Put every portion of a completed pass back on the calendar individually.
 *
 * The whole pass shifts to begin at the completion date plus the interval and
 * keeps its internal rhythm: start juz 2, finish on day 5, earn a 2-day
 * interval, and day 0's portion returns on day 7 and day 1's on day 8.
 *
 * The point is that work comes back at the rate it was created, so the daily
 * load is level by construction. Scheduling the juz as a single row instead
 * meant a whole juz landed on one day and then had to be rationed out, and
 * nobody should ever be handed 20 pages at once.
 *
 * The interval counts from the day the pass actually finished, never the day it
 * was due, or a late juz is instantly overdue again and can never catch up.
 */
async function scheduleCompletedPass(db, userId, juzNumber, firstReturnDate) {
  const juzTotal = getJuzTotalAyahs(juzNumber);
  const sessions = await fetchPassSessions(userId, juzNumber);

  // A repeat re-covers ground already in the list. Spending a day of the return
  // pass on pages it already holds would buy nothing, so each starting offset
  // appears once, keeping the earliest date and the widest range it reached.
  const byStart = new Map();
  for (const row of sessions) {
    const start = Math.min(Math.max(1, row.portion_start_ayah), juzTotal);
    const end = Math.min(Math.max(start, row.portion_end_ayah), juzTotal);
    const existing = byStart.get(start);
    if (!existing) {
      byStart.set(start, { date: row.date, start, end });
    } else if (end > existing.end) {
      existing.end = end;
    }
  }

  // Map iteration is insertion order, which is the order they were recited.
  const portions = [...byStart.values()];

  // No usable history, which happens to a juz seeded straight from onboarding.
  // Fall back to one row for the whole juz: the read path resizes it to fit the
  // day anyway, so this degrades to the old behaviour rather than to nothing.
  if (!portions.length) {
    portions.push({ date: getTodayDateString(), start: 1, end: juzTotal });
  }

  const shift = daysBetween(portions[0].date, firstReturnDate);

  // The pass is laid out fresh each time it completes, so anything still
  // pending from the previous round is set aside first. Worked rows are already
  // marked done; these are the ones the person never reached, usually because a
  // longer session swallowed two rows' worth of ground at once. They are
  // superseded rather than done, so a consistency view does not later count
  // them as work anyone actually did.
  const { error: clearError } = await supabase
    .from('scheduled_portions')
    .update({ status: 'superseded' })
    .eq('user_id', userId)
    .eq('juz_number', juzNumber)
    .eq('status', 'pending');

  if (clearError) {
    throw new Error(clearError.message);
  }

  // Upsert rather than insert: dates always move forward, so a collision with a
  // row from an earlier round should not be possible, but if one ever occurs
  // the right answer is that the slot is scheduled again.
  const { error: insertError } = await supabase.from('scheduled_portions').upsert(
    portions.map((p) => ({
      user_id: userId,
      scheduled_date: addDays(p.date, shift),
      juz_number: juzNumber,
      portion_start_ayah: p.start,
      portion_end_ayah: p.end,
      type: 'full_juz_review',
      status: 'pending',
    })),
    { onConflict: 'user_id,juz_number,portion_start_ayah,scheduled_date' }
  );

  if (insertError) {
    throw new Error(insertError.message);
  }
}

/**
 * Update juz progress after a session and schedule what comes next.
 *
 * @param {string} userId
 * @param {string} sessionId
 * @param {number} juzNumber
 * @param {number} portionStartAyah
 * @param {number} portionEndAyah
 * @param {number} totalAyahsInJuz
 */
export async function updateJuzProgressAfterSession(
  db,
  userId,
  sessionId,
  juzNumber,
  portionStartAyah,
  portionEndAyah,
  totalAyahsInJuz
) {
  const today = getTodayDateString();
  const tomorrow = addDays(today, 1);

  // Needed to size the portion being scheduled. Written as a real range rather
  // than a placeholder because TodayScreen and SessionSummaryScreen both show
  // tomorrow's range to the person, resolving it with getAyahLocation(), which
  // throws on an offset below 1 or past the end of the juz.
  const { data: settings } = await supabase
    .from('users')
    .select('session_minutes, avg_minutes_per_page')
    .eq('id', userId)
    .maybeSingle();
  const sessionMinutes = settings?.session_minutes ?? DEFAULT_SESSION_MINUTES;
  const minutesPerPage = settings?.avg_minutes_per_page ?? DEFAULT_MINUTES_PER_PAGE;

  const sessionMistakes = await fetchMistakeCountForSession(sessionId);
  const progress = await getOrCreateJuzProgress(userId, juzNumber);

  // Mistakes per page, from the real mushaf rather than an ayah average, so
  // the threshold means the same thing in Al-Baqarah (5.5 ayahs to a page) as
  // in juz 30 (28.2). More than 2 per page and the next session halves.
  const pageMap = await loadJuzPageMap(db, juzNumber);
  const pagesRecited = portionPages(pageMap, portionStartAyah, portionEndAyah);
  const wentBadly = exceedsMistakeLimit(sessionMistakes, pagesRecited);

  // The failed ground is repeated once, at half length, from the same start.
  // If the repeat also goes badly they move on anyway, still halved: once
  // means once, so nobody is pinned to the same five pages for a fortnight.
  const repeatNow = wentBadly && !progress.repeat_used;

  const passMistakes = (progress.pass_mistakes ?? 0) + sessionMistakes;
  const juzComplete = !repeatNow && portionEndAyah >= totalAyahsInJuz;

  let firstPassComplete = progress.first_pass_complete;
  let nextFullReviewDate = progress.next_full_review_date;
  let intervalDays = progress.interval_days;
  let nextPassMistakes = passMistakes;

  if (juzComplete) {
    firstPassComplete = true;
    // The ceiling is however long one full round takes at this person's pace,
    // so someone with 2 juz is not left idle for three weeks at a time.
    const ceiling = intervalCeilingDays(
      await fetchJuzCount(userId),
      sessionMinutes,
      minutesPerPage
    );
    intervalDays = getNextReviewDate(passMistakes, intervalDays, ceiling);
    // Counted from the day the pass actually finished, never the day it was
    // due. Counting from the due date leaves a late juz instantly overdue
    // again, with no way to catch up.
    nextFullReviewDate = addDays(today, intervalDays);
    // Resets at the start of each visit. It used to climb across passes, so
    // every juz eventually stuck at the 2-day floor however well it was known.
    nextPassMistakes = 0;
  }

  const { error: updateError } = await supabase
    .from('juz_progress')
    .update({
      pass_mistakes: nextPassMistakes,
      first_pass_complete: firstPassComplete,
      next_full_review_date: nextFullReviewDate,
      interval_days: intervalDays,
      portion_halved: wentBadly,
      // Spent by the repeat, and handed back once fresh ground is reached.
      repeat_used: repeatNow,
    })
    .eq('id', progress.id);

  if (updateError) {
    throw new Error(updateError.message);
  }

  // After the progress write, so a failure here cannot lose the session's
  // result. A wrong pace costs someone a slightly mis-sized portion tomorrow;
  // a lost session result costs them the session.
  try {
    await refreshMeasuredPace(db, userId);
  } catch (err) {
    console.error('[plan] pace measurement failed:', err?.message);
  }

  // Close out the rows this session settled. Marked rather than deleted, so the
  // schedule stays readable afterwards: what the app *planned* is the only
  // thing `sessions` cannot reconstruct, and it is what a consistency view
  // would be built from. Portions are picked oldest-first, so any row left
  // pending here would simply be handed back tomorrow instead of the next one.
  //
  // Two different fates, and the distinction matters precisely because these
  // rows are now kept. Ground this session actually covered is done; ground it
  // did not is superseded. Marking the whole backlog done would be the easy
  // query and would quietly inflate every statistic built on top of it,
  // crediting someone for portions they skipped.
  // Only the ground this session actually covered. Overdue rows it never
  // reached stay pending on purpose: they are still owed, and the settled
  // handling of falling behind is that nothing is dropped and the rest is there
  // tomorrow. Oldest-first hands them back one day at a time until the backlog
  // clears. Superseding them would have quietly rewritten a person's backlog
  // into a single larger portion, and would have counted rows they had merely
  // not got to yet as rows the schedule abandoned.
  //
  // No date filter, because a portion can now be pulled forward and worked
  // before the day it was booked for.
  const { data: covered, error: coveredError } = await supabase
    .from('scheduled_portions')
    .select('scheduled_date')
    .eq('user_id', userId)
    .eq('juz_number', juzNumber)
    .eq('status', 'pending')
    .gte('portion_start_ayah', portionStartAyah)
    .lte('portion_start_ayah', portionEndAyah)
    .order('scheduled_date', { ascending: true });

  if (coveredError) {
    throw new Error(coveredError.message);
  }

  const { error: doneError } = await supabase
    .from('scheduled_portions')
    .update({ status: 'done' })
    .eq('user_id', userId)
    .eq('juz_number', juzNumber)
    .eq('status', 'pending')
    .gte('portion_start_ayah', portionStartAyah)
    .lte('portion_start_ayah', portionEndAyah);

  if (doneError) {
    throw new Error(doneError.message);
  }

  // Worked ahead of its booked day, so the rest of the pass comes with it. The
  // schedule re-anchors to the day work actually happened, which is the same
  // rule lateness already follows, run in the other direction. Someone who
  // works ahead genuinely moves their whole rotation earlier rather than
  // banking a free day they can never spend.
  const pulledFrom = covered?.[0]?.scheduled_date;
  if (pulledFrom && pulledFrom > today) {
    const daysEarly = daysBetween(today, pulledFrom);

    const { data: rest, error: restError } = await supabase
      .from('scheduled_portions')
      .select('id, scheduled_date')
      .eq('user_id', userId)
      .eq('juz_number', juzNumber)
      .eq('status', 'pending');

    if (restError) {
      throw new Error(restError.message);
    }

    for (const row of rest ?? []) {
      const { error: shiftError } = await supabase
        .from('scheduled_portions')
        .update({ scheduled_date: addDays(row.scheduled_date, -daysEarly) })
        .eq('id', row.id);
      if (shiftError) {
        throw new Error(shiftError.message);
      }
    }
  }

  if (juzComplete) {
    // A completed juz always books its next visit. There is no longer a
    // pass/fail gate deciding whether it earns one.
    await scheduleCompletedPass(db, userId, juzNumber, nextFullReviewDate);
    return;
  }

  // Mid-pass. Where does the next unrecited ayah of this juz sit?
  const nextStartAyah = repeatNow ? portionStartAyah : portionEndAyah + 1;

  const { data: stillPending, error: pendingError } = await supabase
    .from('scheduled_portions')
    .select('portion_start_ayah')
    .eq('user_id', userId)
    .eq('juz_number', juzNumber)
    .eq('status', 'pending')
    .order('portion_start_ayah', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (pendingError) {
    throw new Error(pendingError.message);
  }

  // A return pass already has every one of its portions on the calendar, so
  // there is usually nothing to add and tomorrow's work is simply the next row.
  // Only a first pass, discovered one portion at a time, writes ahead of itself.
  //
  // The exception is a gap. A session ends where today's budget runs out, not
  // where the row said it would, so someone who has since cut their session
  // length can stop short of the row they were working through. The next row
  // then starts beyond where they actually reached, and without this the ayahs
  // in between would be silently skipped for a whole round.
  //
  // A repeat always writes its own row: it goes back over ground already marked
  // done, and its lower starting offset wins the oldest-first ordering against
  // anything else booked for that day.
  if (!repeatNow && stillPending && stillPending.portion_start_ayah <= nextStartAyah) {
    return;
  }

  const { error: scheduleError } = await supabase
    .from('scheduled_portions')
    .upsert(
      {
        user_id: userId,
        scheduled_date: tomorrow,
        juz_number: juzNumber,
        // The repeat goes back over the same ground; otherwise carry on from
        // where this session stopped.
        portion_start_ayah: nextStartAyah,
        portion_end_ayah: await computePortionEnd(
          db,
          juzNumber,
          nextStartAyah,
          sessionMinutes,
          minutesPerPage,
          0,
          wentBadly
        ),
        type: 'revision',
        status: 'pending',
      },
      { onConflict: 'user_id,juz_number,portion_start_ayah,scheduled_date' }
    );

  if (scheduleError) {
    throw new Error(scheduleError.message);
  }
}

/**
 * Everything the Today screen needs, as one number each.
 *
 * The quiz is costed from the ayahs actually due before the portion is sized,
 * which is the whole point: the quiz is never cut, so it has to be paid for
 * first. A flat per-item estimate would be wrong by a factor of 40 at the
 * extremes, since An-Naba 1 takes 3 seconds and Al-Baqarah 282 takes two
 * minutes.
 */
export async function getTodayPlan(db, userId) {
  const today = getTodayDateString();

  const { data: user, error: userError } = await supabase
    .from('users')
    .select('session_minutes, avg_minutes_per_page')
    .eq('id', userId)
    .maybeSingle();

  if (userError) {
    throw new Error(userError.message);
  }

  const sessionMinutes = user?.session_minutes ?? DEFAULT_SESSION_MINUTES;
  const minutesPerPage = user?.avg_minutes_per_page ?? DEFAULT_MINUTES_PER_PAGE;
  const { items, minutes: dueQuizMinutes } = await dueQuizCost(db, userId, minutesPerPage);
  const { portions, waiting } = await getTodayPortions(db, userId, dueQuizMinutes);

  return {
    portions,
    quizItemCount: items.length,
    dueQuizMinutes,
    // Every portion of the day, so a day carrying two juz reads as what it
    // actually costs rather than as one of them.
    estimateMinutes: sessionEstimateMinutes(
      dueQuizMinutes,
      portions.reduce((sum, p) => sum + (p.recitationMinutes ?? 0), 0),
      portions.reduce((sum, p) => sum + (p.pages ?? 0), 0)
    ),
    // Portions rather than juz. Counting juz meant someone five days behind
    // inside a single juz was told nothing was waiting, because their one juz
    // was also the one they were being served.
    portionsWaiting: waiting,
    hasWorkTomorrow: await hasWorkOn(userId, addDays(today, 1)),
    // Only looked up when today is empty, which is the only time it is shown.
    nextSession: portions.length === 0
      ? await getNextScheduledSession(db, userId, sessionMinutes, minutesPerPage)
      : null,
  };
}

/**
 * The next session waiting in the future, for a day that holds nothing.
 *
 * A day with nothing due used to be a dead end: "Nothing due today" and no hint
 * of what comes next or when. Naming the portion and its date turns it into
 * something worth reading, and gives a person with time today something they
 * can choose to start.
 */
async function getNextScheduledSession(db, userId, sessionMinutes, minutesPerPage) {
  const today = getTodayDateString();

  const { data: row, error } = await supabase
    .from('scheduled_portions')
    .select('juz_number, portion_start_ayah, portion_end_ayah, type, scheduled_date')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .gt('scheduled_date', today)
    .order('scheduled_date', { ascending: true })
    .order('juz_number', { ascending: true })
    .order('portion_start_ayah', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!row) return null;

  const { data: progress } = await supabase
    .from('juz_progress')
    .select('portion_halved')
    .eq('user_id', userId)
    .eq('juz_number', row.juz_number)
    .maybeSingle();

  // Sized with no quiz cost: what is due on that day cannot be known today.
  return mapScheduledRow(
    db,
    row,
    sessionMinutes,
    minutesPerPage,
    0,
    progress?.portion_halved === true
  );
}

/**
 * Whether a given day holds anything at all: a portion to recite or a review
 * that has come due.
 *
 * Used to decide whether tomorrow's reminder is worth sending. A notification
 * asking someone to open an app that has nothing for them is how people learn
 * to ignore notifications, and it costs the reminder its credibility on the
 * days that do matter.
 */
async function hasWorkOn(userId, date) {
  const { count: scheduled, error: scheduledError } = await supabase
    .from('scheduled_portions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'pending')
    .lte('scheduled_date', date);

  if (scheduledError) throw new Error(scheduledError.message);
  if ((scheduled ?? 0) > 0) return true;

  const { count: reviews, error: reviewError } = await supabase
    .from('juz_progress')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('first_pass_complete', true)
    .lte('next_full_review_date', date);

  if (reviewError) throw new Error(reviewError.message);
  if ((reviews ?? 0) > 0) return true;

  const { count: quiz, error: quizError } = await supabase
    .from('quiz_queue')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .lte('next_review_date', date);

  if (quizError) throw new Error(quizError.message);
  if ((quiz ?? 0) > 0) return true;

  // A juz still on its first pass always has more to recite tomorrow, whether
  // or not a row has been written for it yet.
  const { count: unfinished, error: unfinishedError } = await supabase
    .from('juz_progress')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('first_pass_complete', false);

  if (unfinishedError) throw new Error(unfinishedError.message);
  return (unfinished ?? 0) > 0;
}

