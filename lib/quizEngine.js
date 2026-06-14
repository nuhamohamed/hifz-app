import { supabase } from './supabase';

const BOX_REVIEW_OFFSET_DAYS = {
  0: 0,
  1: 1,
  2: 3,
  3: 7,
  4: 14,
  5: 30,
};

function getTodayDateString() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDaysToDateString(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  const ny = date.getFullYear();
  const nm = String(date.getMonth() + 1).padStart(2, '0');
  const nd = String(date.getDate()).padStart(2, '0');
  return `${ny}-${nm}-${nd}`;
}

function nextReviewDateForBox(boxLevel, fromDate = getTodayDateString()) {
  const offset = BOX_REVIEW_OFFSET_DAYS[boxLevel] ?? 0;
  return addDaysToDateString(fromDate, offset);
}

function deduplicateByContextOverlap(items) {
  const kept = [];
  for (const item of items) {
    const overlaps = kept.some(
      (k) =>
        k.surah_number === item.surah_number &&
        Math.abs(k.ayah_number - item.ayah_number) <= 3
    );
    if (!overlaps) {
      kept.push(item);
    }
  }
  return kept;
}

/**
 * Fetch quiz items due today or earlier for a user.
 *
 * @param {string} userId
 * @returns {Promise<{ id: string, surah_number: number, ayah_number: number, box_level: number }[]>}
 */
export async function fetchDueQuizItems(userId) {
  const today = getTodayDateString();

  const { data, error } = await supabase
    .from('quiz_queue')
    .select('id, surah_number, ayah_number, box_level')
    .eq('user_id', userId)
    .lte('next_review_date', today)
    .order('box_level', { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return deduplicateByContextOverlap(data ?? []);
}

/**
 * Fetch post-session quiz items from this session's recitation mistakes only.
 *
 * @param {string} userId
 * @param {string} sessionId
 * @returns {Promise<{ id: string, surah_number: number, ayah_number: number, box_level: number }[]>}
 */
export async function fetchPostSessionItems(userId, sessionId) {
  const today = getTodayDateString();

  const { data: mistakes, error: mistakesError } = await supabase
    .from('mistakes')
    .select('surah_number, ayah_number')
    .eq('user_id', userId)
    .eq('session_id', sessionId);

  if (mistakesError) {
    throw new Error(mistakesError.message);
  }

  if (!mistakes || mistakes.length === 0) {
    return [];
  }

  for (const m of mistakes) {
    await supabase.from('quiz_queue').upsert(
      {
        user_id: userId,
        surah_number: m.surah_number,
        ayah_number: m.ayah_number,
        box_level: 0,
        next_review_date: today,
      },
      { onConflict: 'user_id,surah_number,ayah_number' }
    );
  }

  const ayahPairs = mistakes.map((m) => `(${m.surah_number},${m.ayah_number})`).join(',');

  const { data: fresh, error } = await supabase
    .from('quiz_queue')
    .select('id, surah_number, ayah_number, box_level')
    .eq('user_id', userId)
    .lte('next_review_date', today)
    .order('ayah_number', { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  // Only return items that came from this session's recitation mistakes
  const mistakeKeys = new Set(
    mistakes.map((m) => `${m.surah_number}-${m.ayah_number}`)
  );

  const filtered = (fresh ?? []).filter((item) =>
    mistakeKeys.has(`${item.surah_number}-${item.ayah_number}`)
  );

  return deduplicateByContextOverlap(filtered);
}

/**
 * Update a quiz_queue row after a quiz attempt.
 *
 * @param {string} itemId
 * @param {'correct_first' | 'correct_second' | 'wrong'} result
 */
export async function updateQuizResult(itemId, result) {
  const today = getTodayDateString();
  const now = new Date().toISOString();

  const { data: item, error: fetchError } = await supabase
    .from('quiz_queue')
    .select('box_level, next_review_date, times_correct_first')
    .eq('id', itemId)
    .single();

  if (fetchError) {
    throw new Error(fetchError.message);
  }

  let update = {
    last_result: result,
    updated_at: now,
  };

  if (result === 'correct_first') {
    const newBoxLevel = Math.min(item.box_level + 1, 5);
    update = {
      ...update,
      box_level: newBoxLevel,
      next_review_date: nextReviewDateForBox(newBoxLevel, today),
      times_correct_first: (item.times_correct_first ?? 0) + 1,
    };
  } else if (result === 'correct_second') {
    update = {
      ...update,
      box_level: item.box_level,
      next_review_date: item.next_review_date,
    };
  } else if (result === 'wrong') {
    update = {
      ...update,
      box_level: 0,
      next_review_date: today,
    };
  }

  const { error: updateError } = await supabase
    .from('quiz_queue')
    .update(update)
    .eq('id', itemId);

  if (updateError) {
    throw new Error(updateError.message);
  }
}

/**
 * Flag a context ayah that was recited with mistakes in quiz context.
 *
 * @param {string} userId
 * @param {number} surahNumber
 * @param {number} ayahNumber
 */
export async function flagContextAyahIfNeeded(
  userId,
  surahNumber,
  ayahNumber
) {
  const today = getTodayDateString();

  const { data: existing, error: fetchError } = await supabase
    .from('quiz_queue')
    .select('context_wrong_count, box_level, next_review_date')
    .eq('user_id', userId)
    .eq('surah_number', surahNumber)
    .eq('ayah_number', ayahNumber)
    .maybeSingle();

  if (fetchError) {
    throw new Error(fetchError.message);
  }

  const newCount = (existing?.context_wrong_count ?? 0) + 1;

  const row = {
    user_id: userId,
    surah_number: surahNumber,
    ayah_number: ayahNumber,
    context_wrong_count: newCount,
    box_level: existing?.box_level ?? 0,
    next_review_date: existing?.next_review_date ?? today,
  };

  if (!existing) {
    row.box_level = 0;
    row.next_review_date = today;
  }

  if (newCount >= 2) {
    row.next_review_date = today;
    row.box_level = 0;
  }

  const { error: upsertError } = await supabase.from('quiz_queue').upsert(row, {
    onConflict: 'user_id,surah_number,ayah_number',
  });

  if (upsertError) {
    throw new Error(upsertError.message);
  }
}

/**
 * Reduce cumulative Tier 2 mistakes when an ayah is healed via quiz.
 *
 * @param {string} userId
 * @param {number} surahNumber
 * @param {number} ayahNumber
 * @param {number} juzNumber
 * @returns {Promise<boolean>} true if healing was applied
 */
export async function checkMistakeHealing(
  userId,
  surahNumber,
  ayahNumber,
  juzNumber
) {
  const { data: row, error: fetchError } = await supabase
    .from('quiz_queue')
    .select('times_correct_first')
    .eq('user_id', userId)
    .eq('surah_number', surahNumber)
    .eq('ayah_number', ayahNumber)
    .maybeSingle();

  if (fetchError) {
    throw new Error(fetchError.message);
  }

  if (!row || (row.times_correct_first ?? 0) < 2) {
    return false;
  }

  const { data: progress, error: progressError } = await supabase
    .from('juz_progress')
    .select('id, cumulative_tier2_mistakes')
    .eq('user_id', userId)
    .eq('juz_number', juzNumber)
    .maybeSingle();

  if (progressError) {
    throw new Error(progressError.message);
  }

  if (!progress) {
    return false;
  }

  const newCumulative = Math.max(
    0,
    (progress.cumulative_tier2_mistakes ?? 0) - 1
  );

  const { error: updateError } = await supabase
    .from('juz_progress')
    .update({ cumulative_tier2_mistakes: newCumulative })
    .eq('id', progress.id);

  if (updateError) {
    throw new Error(updateError.message);
  }

  return true;
}
