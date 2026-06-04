import { supabase } from './supabase';

const DEFAULT_SESSION_MINUTES = 30;
const DEFAULT_AVG_MINUTES_PER_PAGE = 2.0;
const AYAHS_PER_PAGE = 30;
const RECITATION_FRACTION = 0.7;
const JUZ_AYAH_COUNT = 600;

function getTodayDateString() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function calculatePortionAyahs(sessionMinutes, avgMinutesPerPage) {
  const minutes = sessionMinutes ?? DEFAULT_SESSION_MINUTES;
  const avgPerPage = avgMinutesPerPage ?? DEFAULT_AVG_MINUTES_PER_PAGE;
  const recitationMinutes = minutes * RECITATION_FRACTION;
  const portionPages = recitationMinutes / avgPerPage;
  return Math.round(portionPages * AYAHS_PER_PAGE);
}

function mapScheduledRow(row) {
  return {
    juzNumber: row.juz_number,
    portionStartAyah: row.portion_start_ayah,
    portionEndAyah: row.portion_end_ayah,
    type: row.type,
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
 *   | { juzNumber: number, portionStartAyah: number, portionEndAyah: number, type: string }
 *   | { type: 'quiz_only' }
 * >}
 */
export async function getTodayPortion(userId) {
  const today = getTodayDateString();

  const { data: scheduled, error: scheduledError } = await supabase
    .from('scheduled_portions')
    .select('juz_number, portion_start_ayah, portion_end_ayah, type')
    .eq('user_id', userId)
    .eq('scheduled_date', today)
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
    .single();

  if (userError) {
    throw new Error(userError.message);
  }

  const portionAyahs = calculatePortionAyahs(
    user.session_minutes,
    user.avg_minutes_per_page
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
    return {
      juzNumber: fullReview.juz_number,
      portionStartAyah,
      portionEndAyah: portionStartAyah + portionSize - 1,
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
    return {
      juzNumber: inProgress.juz_number,
      portionStartAyah,
      portionEndAyah: portionStartAyah + portionSize - 1,
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
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return calculatePortionAyahs(user.session_minutes, user.avg_minutes_per_page);
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

  return Math.min(
    Math.floor(currentPortionAyahs * 1.1),
    maxPortionAyahs
  );
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
        portion_end_ayah: portionEndAyah + newPortionAyahs,
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
      portion_end_ayah: newPortionAyahs,
      type: 'full_juz_review',
    });

  if (retryScheduleError) {
    throw new Error(retryScheduleError.message);
  }
}
