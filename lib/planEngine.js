import { supabase } from './supabase';
import { getJuzTotalAyahs, JUZ_DATA } from './juzSurahMap';
import { getJuzAyahPages } from './mushafDb';
import {
  DEFAULT_MINUTES_PER_PAGE,
  recitationBudgetMinutes,
  resolvePortionEnd,
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
async function computePortionEnd(db, juzNumber, startOffset, sessionMinutes, minutesPerPage, dueQuizMinutes) {
  const pageMap = await loadJuzPageMap(db, juzNumber);
  const budget = recitationBudgetMinutes(
    sessionMinutes ?? DEFAULT_SESSION_MINUTES,
    dueQuizMinutes ?? 0,
    minutesPerPage ?? DEFAULT_MINUTES_PER_PAGE
  );
  const { endOffset } = resolvePortionEnd(
    pageMap,
    startOffset,
    budget,
    minutesPerPage ?? DEFAULT_MINUTES_PER_PAGE
  );
  return endOffset;
}

const DEFAULT_SESSION_MINUTES = 30;
// Mean ayahs per juz, 6236 / 30. Only computeNewPortionAyahs() still uses it,
// and that goes when the mistakes-per-page halving rule lands. Portion sizing
// no longer goes anywhere near an ayah average.
const JUZ_AYAH_COUNT = 208;

function getTodayDateString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Rows written before the clamp below existed can still run past the end of
// their juz, and callers resolve these offsets with getAyahLocation(), which
// throws when one is out of range. Clamp on read so an already-persisted bad
// row degrades to a short final portion instead of bricking the Today screen.
async function mapScheduledRow(db, row, sessionMinutes, minutesPerPage, dueQuizMinutes) {
  const juzTotal = getJuzTotalAyahs(row.juz_number);
  const portionStartAyah = Math.min(row.portion_start_ayah, juzTotal);
  return {
    juzNumber: row.juz_number,
    portionStartAyah,
    // The stored end is deliberately ignored. A scheduled row records *where*
    // work resumes; how far it reaches is a property of today, not of the day
    // it was written. Someone who has since dropped from 30 minutes to 15, or
    // who has a heavy quiz due, gets a portion that fits today rather than one
    // sized for the past. It also means rows written by the old ayah-count
    // scheduler resize themselves instead of having to be migrated.
    portionEndAyah: await computePortionEnd(
      db,
      row.juz_number,
      portionStartAyah,
      sessionMinutes,
      minutesPerPage,
      dueQuizMinutes
    ),
    type: row.type,
    scheduledDate: row.scheduled_date,
  };
}

/**
 * Days until next full juz review based on cumulative Tier 2 mistakes.
 *
 * @param {number} cumulativeMistakes
 * @returns {number}
 */
export function getNextReviewDate(cumulativeMistakes) {
  if (cumulativeMistakes <= 1) {
    return 21;
  }
  if (cumulativeMistakes <= 3) {
    return 14;
  }
  if (cumulativeMistakes <= 5) {
    return 7;
  }
  if (cumulativeMistakes <= 9) {
    return 3;
  }
  return 2;
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
export async function getTodayPortion(db, userId, dueQuizMinutes = 0) {
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

  const { data: scheduled, error: scheduledError } = await supabase
    .from('scheduled_portions')
    .select('juz_number, portion_start_ayah, portion_end_ayah, type, scheduled_date')
    .eq('user_id', userId)
    .lte('scheduled_date', today)
    .order('scheduled_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (scheduledError) {
    throw new Error(scheduledError.message);
  }

  if (scheduled) {
    return mapScheduledRow(db, scheduled, sessionMinutes, minutesPerPage, dueQuizMinutes);
  }

  const { data: fullReviewRows, error: fullReviewError } = await supabase
    .from('juz_progress')
    .select('juz_number')
    .eq('user_id', userId)
    .eq('gate_passed', true)
    .lte('next_full_review_date', today)
    .order('cumulative_tier2_mistakes', { ascending: false })
    .order('juz_number', { ascending: true })
    .limit(1);

  if (fullReviewError) {
    throw new Error(fullReviewError.message);
  }

  const fullReview = fullReviewRows?.[0];
  if (fullReview) {
    const portionStartAyah = 1;
    return {
      juzNumber: fullReview.juz_number,
      portionStartAyah,
      portionEndAyah: await computePortionEnd(
        db,
        fullReview.juz_number,
        portionStartAyah,
        sessionMinutes,
        minutesPerPage,
        dueQuizMinutes
      ),
      type: 'full_juz_review',
    };
  }

  const { data: inProgressRows, error: inProgressError } = await supabase
    .from('juz_progress')
    .select('juz_number')
    .eq('user_id', userId)
    .eq('gate_passed', false)
    .order('juz_number', { ascending: true })
    .limit(1);

  if (inProgressError) {
    throw new Error(inProgressError.message);
  }

  const inProgress = inProgressRows?.[0];
  if (inProgress) {
    const portionStartAyah = await getNextPortionStartAyah(
      userId,
      inProgress.juz_number
    );
    const juzTotal = getJuzTotalAyahs(inProgress.juz_number);
    // Past the end of the juz means the pass is finished. Clamped rather than
    // allowed through, because getAyahLocation() throws on an out-of-range
    // offset and does so during render, which blanks the screen.
    if (portionStartAyah > juzTotal) {
      return { type: 'quiz_only' };
    }
    return {
      juzNumber: inProgress.juz_number,
      portionStartAyah,
      portionEndAyah: await computePortionEnd(
        db,
        inProgress.juz_number,
        portionStartAyah,
        sessionMinutes,
        minutesPerPage,
        dueQuizMinutes
      ),
      type: 'revision',
    };
  }

  return { type: 'quiz_only' };
}

async function getNextPortionStartAyah(userId, juzNumber) {
  const { data: lastSession, error } = await supabase
    .from('sessions')
    .select('portion_end_ayah')
    .eq('user_id', userId)
    .eq('juz_number', juzNumber)
    .eq('status', 'complete')
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

async function fetchUserPortionAyahs(userId) {
  const { data: user, error } = await supabase
    .from('users')
    .select('session_minutes, avg_minutes_per_page')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  // Portion size is no longer an ayah count. It is derived from session
  // minutes and the person's pace every time getTodayPortion() runs, so
  // current_portion_ayahs is not the source of truth for anything and this
  // returns null rather than a stale number. The column, and this function,
  // are replaced entirely when the halving rule lands.
  void user;
  return null;
}

async function fetchTier2CountForSession(sessionId) {
  const { count, error } = await supabase
    .from('mistakes')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .eq('tier', 2);

  if (error) {
    throw new Error(error.message);
  }

  return count ?? 0;
}

async function getOrCreateJuzProgress(userId, juzNumber, defaultPortionAyahs) {
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
      cumulative_tier2_mistakes: 0,
      gate_passed: false,
      current_portion_ayahs: defaultPortionAyahs,
    })
    .select()
    .single();

  if (insertError) {
    throw new Error(insertError.message);
  }

  return created;
}

function computeNewPortionAyahs(
  currentPortionAyahs,
  tier2Count,
  maxPortionAyahs
) {
  const threshold = Math.max(
    1,
    Math.ceil((currentPortionAyahs / JUZ_AYAH_COUNT) * 10)
  );

  if (tier2Count > threshold) {
    return Math.max(1, Math.floor(currentPortionAyahs / 2));
  }

  // Math.floor(n * 1.1) is a no-op for any n below 10, so a portion seeded at
  // the onboarding default of 7 could never grow: floor(7 * 1.1) === 7. Step by
  // at least one ayah so a clean session always makes visible progress.
  const grown = Math.max(
    currentPortionAyahs + 1,
    Math.floor(currentPortionAyahs * 1.1)
  );

  return Math.min(grown, maxPortionAyahs);
}

/**
 * Seed juz_progress rows from memorized_portions after onboarding.
 * Creates one row per distinct juz the user has memorized, skipping any that already exist.
 */
export async function seedJuzProgressFromMemorized(userId) {
  const [{ data: portions, error: portionsError }, portionAyahs] =
    await Promise.all([
      supabase
        .from('memorized_portions')
        .select('juz_number')
        .eq('user_id', userId),
      fetchUserPortionAyahs(userId),
    ]);

  if (portionsError) {
    throw new Error(portionsError.message);
  }

  const juzNumbers = [...new Set((portions ?? []).map((r) => r.juz_number))];

  for (const juzNumber of juzNumbers) {
    await getOrCreateJuzProgress(userId, juzNumber, portionAyahs);
  }
}

/**
 * Update juz progress after a session and schedule the next portion.
 *
 * @param {string} userId
 * @param {string} sessionId
 * @param {number} juzNumber
 * @param {number} portionEndAyah
 * @param {number} totalAyahsInJuz
 */
export async function updateJuzProgressAfterSession(
  db,
  userId,
  sessionId,
  juzNumber,
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

  const tier2Count = await fetchTier2CountForSession(sessionId);
  const maxPortionAyahs = await fetchUserPortionAyahs(userId);

  const progress = await getOrCreateJuzProgress(
    userId,
    juzNumber,
    maxPortionAyahs
  );

  const currentPortionAyahs =
    progress.current_portion_ayahs ?? maxPortionAyahs;
  const newCumulative =
    (progress.cumulative_tier2_mistakes ?? 0) + tier2Count;

  let newPortionAyahs = computeNewPortionAyahs(
    currentPortionAyahs,
    tier2Count,
    maxPortionAyahs
  );

  const juzComplete = portionEndAyah >= totalAyahsInJuz;
  let gatePassed = progress.gate_passed;
  let nextFullReviewDate = progress.next_full_review_date;

  if (juzComplete) {
    gatePassed = newCumulative <= 5;
    const reviewDays = getNextReviewDate(newCumulative);
    nextFullReviewDate = addDays(today, reviewDays);

    if (!gatePassed && newCumulative > 9) {
      newPortionAyahs = Math.max(
        1,
        Math.floor(currentPortionAyahs / 2)
      );
    }
  }

  const { error: updateError } = await supabase
    .from('juz_progress')
    .update({
      cumulative_tier2_mistakes: newCumulative,
      gate_passed: gatePassed,
      next_full_review_date: juzComplete ? nextFullReviewDate : progress.next_full_review_date,
      current_portion_ayahs: newPortionAyahs,
    })
    .eq('id', progress.id);

  if (updateError) {
    throw new Error(updateError.message);
  }

  if (!juzComplete) {
    const { error: scheduleError } = await supabase
      .from('scheduled_portions')
      .insert({
        user_id: userId,
        scheduled_date: tomorrow,
        juz_number: juzNumber,
        portion_start_ayah: portionEndAyah + 1,
        portion_end_ayah: await computePortionEnd(
          db,
          juzNumber,
          portionEndAyah + 1,
          sessionMinutes,
          minutesPerPage,
          0
        ),
        type: 'revision',
      });

    if (scheduleError) {
      throw new Error(scheduleError.message);
    }
    return;
  }

  if (gatePassed) {
    return;
  }

  const { error: retryScheduleError } = await supabase
    .from('scheduled_portions')
    .insert({
      user_id: userId,
      scheduled_date: nextFullReviewDate,
      juz_number: juzNumber,
      portion_start_ayah: 1,
      portion_end_ayah: await computePortionEnd(
        db,
        juzNumber,
        1,
        sessionMinutes,
        minutesPerPage,
        0
      ),
      type: 'full_juz_review',
    });

  if (retryScheduleError) {
    throw new Error(retryScheduleError.message);
  }
}
