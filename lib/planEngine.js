import { supabase } from './supabase';
import { getJuzTotalAyahs } from './juzSurahMap';

const DEFAULT_SESSION_MINUTES = 30;
const DEFAULT_AVG_MINUTES_PER_PAGE = 2.0;
// 6236 ayahs across 604 mushaf pages. This was 30, which inflated every
// portion estimate roughly 3x (a 30-minute session came out at 315 ayahs,
// more than two entire juz).
const AYAHS_PER_PAGE = 10.3;
const RECITATION_FRACTION = 0.7;
// Mean ayahs per juz: 6236 / 30. This was 600, which skewed the mistake
// threshold in computeNewPortionAyahs() by the same factor.
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

function calculatePortionAyahs(sessionMinutes, avgMinutesPerPage) {
  const minutes = sessionMinutes ?? DEFAULT_SESSION_MINUTES;
  const avgPerPage = avgMinutesPerPage ?? DEFAULT_AVG_MINUTES_PER_PAGE;
  const recitationMinutes = minutes * RECITATION_FRACTION;
  const portionPages = recitationMinutes / avgPerPage;
  return Math.round(portionPages * AYAHS_PER_PAGE);
}

// Rows written before the clamp below existed can still run past the end of
// their juz, and callers resolve these offsets with getAyahLocation(), which
// throws when one is out of range. Clamp on read so an already-persisted bad
// row degrades to a short final portion instead of bricking the Today screen.
function mapScheduledRow(row) {
  const juzTotal = getJuzTotalAyahs(row.juz_number);
  const portionStartAyah = Math.min(row.portion_start_ayah, juzTotal);
  return {
    juzNumber: row.juz_number,
    portionStartAyah,
    portionEndAyah: Math.min(
      Math.max(row.portion_end_ayah, portionStartAyah),
      juzTotal
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
export async function getTodayPortion(userId) {
  const today = getTodayDateString();

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
    return mapScheduledRow(scheduled);
  }

  const { data: user, error: userError } = await supabase
    .from('users')
    .select('session_minutes, avg_minutes_per_page')
    .eq('id', userId)
    .maybeSingle();

  if (userError) {
    throw new Error(userError.message);
  }

  const portionAyahs = calculatePortionAyahs(
    user?.session_minutes ?? null,
    user?.avg_minutes_per_page ?? null
  );

  const { data: fullReviewRows, error: fullReviewError } = await supabase
    .from('juz_progress')
    .select('juz_number, current_portion_ayahs')
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
    const portionSize = fullReview.current_portion_ayahs ?? portionAyahs;
    const portionStartAyah = 1;
    const juzTotal = getJuzTotalAyahs(fullReview.juz_number);
    return {
      juzNumber: fullReview.juz_number,
      portionStartAyah,
      portionEndAyah: Math.min(portionStartAyah + portionSize - 1, juzTotal),
      type: 'full_juz_review',
    };
  }

  const { data: inProgressRows, error: inProgressError } = await supabase
    .from('juz_progress')
    .select('juz_number, current_portion_ayahs')
    .eq('user_id', userId)
    .eq('gate_passed', false)
    .order('juz_number', { ascending: true })
    .limit(1);

  if (inProgressError) {
    throw new Error(inProgressError.message);
  }

  const inProgress = inProgressRows?.[0];
  if (inProgress) {
    const portionSize = inProgress.current_portion_ayahs ?? portionAyahs;
    const portionStartAyah = await getNextPortionStartAyah(
      userId,
      inProgress.juz_number
    );
    const juzTotal = getJuzTotalAyahs(inProgress.juz_number);
    return {
      juzNumber: inProgress.juz_number,
      portionStartAyah,
      portionEndAyah: Math.min(portionStartAyah + portionSize - 1, juzTotal),
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

  return calculatePortionAyahs(
    user?.session_minutes ?? null,
    user?.avg_minutes_per_page ?? null
  );
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
  userId,
  sessionId,
  juzNumber,
  portionEndAyah,
  totalAyahsInJuz
) {
  const today = getTodayDateString();
  const tomorrow = addDays(today, 1);

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
        // Must not run past the end of the juz. getTodayPortion() returns a
        // scheduled row verbatim, and TodayScreen resolves it with
        // getAyahLocation(), which throws on an out-of-range offset -- during
        // render, where there is no error boundary to catch it.
        portion_end_ayah: Math.min(
          portionEndAyah + newPortionAyahs,
          totalAyahsInJuz
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
      portion_end_ayah: Math.min(newPortionAyahs, totalAyahsInJuz),
      type: 'full_juz_review',
    });

  if (retryScheduleError) {
    throw new Error(retryScheduleError.message);
  }
}
