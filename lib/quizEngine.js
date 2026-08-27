import { addDays as addDaysToDateString, todayString as getTodayDateString } from './dates';
import { supabase } from './supabase';

const BOX_REVIEW_OFFSET_DAYS = {
  0: 0,
  1: 1,
  2: 3,
  3: 7,
  4: 14,
  5: 30,
};

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
/**
 * Anki's leech threshold. At 8 failures Anki suspends the card, on the
 * reasoning that a card failed that often is badly written and more repetition
 * will not save it. An ayah of the Qur'an cannot be suspended, rewritten or
 * decided against, so the detection carries over and the remedy does not.
 */
export const LEECH_THRESHOLD = 8;

/**
 * Most flagged ayahs allowed in one quiz. A handful of stubborn verses would
 * otherwise fill the whole thing and crowd out everything else that is due.
 * A quiz runs 10 to 15 items, so 3 is about a fifth: worked on, not dominant.
 */
export const MAX_LEECHES_PER_QUIZ = 3;

export async function fetchDueQuizItems(userId) {
  const today = getTodayDateString();

  const { data, error } = await supabase
    .from('quiz_queue')
    .select('id, surah_number, ayah_number, box_level, lapses')
    .eq('user_id', userId)
    .lte('next_review_date', today)
    .order('box_level', { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return capLeeches(deduplicateByContextOverlap(data ?? []));
}

/**
 * Keeps at most MAX_LEECHES_PER_QUIZ flagged ayahs, preserving order so the
 * shakiest still come first. The ones dropped are not lost: they stay due and
 * come back tomorrow, which is the same treatment overflow gets everywhere
 * else. Nothing is ever discarded, only deferred.
 */
function capLeeches(items) {
  let leeches = 0;
  return items.filter((item) => {
    if ((item.lapses ?? 0) < LEECH_THRESHOLD) return true;
    leeches += 1;
    return leeches <= MAX_LEECHES_PER_QUIZ;
  });
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
    .select('box_level, next_review_date, times_correct_first, lapses')
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
      // Counted, not acted on. See LEECH_THRESHOLD above for why the count has
      // to come before any feature built on top of it.
      lapses: (item.lapses ?? 0) + 1,
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

// checkMistakeHealing() lived here. It quietly subtracted from a juz's
// mistake count when a previously-wrong ayah came up correct twice. Removed
// rather than repaired: it credited whichever juz you happened to be revising
// today rather than the ayah's own, and nothing recorded that an ayah had
// already been forgiven, so a well-known ayah kept subtracting every time it
// appeared. It was also a second, worse copy of a reward the box system
// already gives. A pass's mistake count is now simply the mistakes made
// during that pass, and only the person clearing a misflag by hand reduces it.


/**
 * Removes an ayah from the review queue entirely.
 *
 * Called when someone clears every flagged word on an ayah, having judged that
 * the app misheard them. Dismissing used to delete only the mistake record,
 * which feeds the juz count, and never touched this table, so a misflagged
 * ayah kept being quizzed every morning after they had told the app it was
 * fine. Automatic detection cannot tell a memory failure from the recogniser
 * mishearing a verse; the person looking at the transcript beside the expected
 * text can, which makes this the best leech defence in the app.
 */
export async function removeFromQuizQueue(userId, surahNumber, ayahNumber) {
  const { error } = await supabase
    .from('quiz_queue')
    .delete()
    .eq('user_id', userId)
    .eq('surah_number', surahNumber)
    .eq('ayah_number', ayahNumber);

  if (error) {
    throw new Error(error.message);
  }
}
