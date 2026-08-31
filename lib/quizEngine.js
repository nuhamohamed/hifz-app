import { addDays as addDaysToDateString, todayString as getTodayDateString, tomorrowString } from './dates';
import { getAyahPageShares } from './mushafDb';
import { quizMinutes } from './portionMath';
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
  const { data: mistakes, error: mistakesError } = await supabase
    .from('mistakes')
    .select('surah_number, ayah_number')
    .eq('user_id', userId)
    .eq('session_id', sessionId)
    // A mistake the person has cleared as a misflag is not one to quiz them on.
    .is('dismissed_at', null);

  if (mistakesError) {
    throw new Error(mistakesError.message);
  }

  if (!mistakes || mistakes.length === 0) {
    return [];
  }

  // Tomorrow, for the same reason as the recitation screen: this quiz finds its
  // items through the mistakes table, not through a queue row dated today, and
  // dating them today makes them due for a mistake review in the same day they
  // were made. Answering them here reschedules them properly anyway.
  for (const m of mistakes) {
    await supabase.from('quiz_queue').upsert(
      {
        user_id: userId,
        surah_number: m.surah_number,
        ayah_number: m.ayah_number,
        box_level: 0,
        next_review_date: tomorrowString(),
      },
      { onConflict: 'user_id,surah_number,ayah_number' }
    );
  }

  // Narrowed to the surahs this session touched, which is normally one or two.
  // The exact ayah match still happens below; this only stops the query
  // dragging back every item the person has due, a payload that grows with
  // their backlog rather than with the length of the session they just did.
  // A line here used to build the pair list for this filter and then never
  // apply it, so the whole queue was fetched and thrown away.
  const surahs = [...new Set(mistakes.map((m) => m.surah_number))];

  // Deliberately not filtered by next_review_date. This quiz is defined by the
  // mistakes made in this session, not by what is due: the rows above are dated
  // tomorrow, so a due-date filter here would exclude the very items just
  // queued and the recap would always come back empty.
  const { data: fresh, error } = await supabase
    .from('quiz_queue')
    .select('id, surah_number, ayah_number, box_level')
    .eq('user_id', userId)
    .in('surah_number', surahs)
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
 * The due quiz, with what it will actually cost in minutes.
 *
 * This is the number the portion is sized against. The quiz is never cut, so it
 * is paid for first and the portion takes what is left; until this existed
 * every caller passed zero and the portion was sized as though the quiz were
 * free, which is why a heavy quiz day overran.
 *
 * Costed per item from the ayah's real share of its page rather than a flat
 * average, because a flat average is wrong by a factor of 40 at the extremes:
 * An-Naba 1 is 3 seconds and Al-Baqarah 282 is two minutes.
 *
 * @param {import('expo-sqlite').SQLiteDatabase} db
 * @returns {Promise<{ items: object[], minutes: number }>}
 */
export async function dueQuizCost(db, userId, minutesPerPage) {
  const items = await fetchDueQuizItems(userId);
  if (!items.length) return { items, minutes: 0 };

  const shares = await getAyahPageShares(
    db,
    items.map((i) => ({ surah: i.surah_number, ayah: i.ayah_number }))
  );

  // An ayah the mushaf database does not recognise falls back to the average
  // inside quizMinutes() rather than costing nothing.
  const costed = items.map((i) => ({
    ...i,
    pageShare: shares.get(`${i.surah_number}:${i.ayah_number}`),
  }));

  return { items: costed, minutes: quizMinutes(costed, minutesPerPage) };
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
    // Right on the second attempt: no promotion, but it still has to move.
    //
    // This used to write item.next_review_date straight back. Every item in a
    // quiz got there by being due, so that date is always today or earlier,
    // and writing it back unchanged left the row permanently due: fetched
    // again the next day, and the day after, for as long as the person kept
    // needing two attempts. The home screen counts the same query, so
    // "Mistake Review - N ayahs to go over" never cleared either. That is the
    // exact bug the 'wrong' branch below was already fixed for.
    //
    // The box keeps its own spacing where it has any, and box 0, whose offset
    // is zero days, falls back to tomorrow rather than landing on today again.
    const held = nextReviewDateForBox(item.box_level, today);
    update = {
      ...update,
      box_level: item.box_level,
      next_review_date: held > today ? held : tomorrowString(),
    };
  } else if (result === 'wrong') {
    update = {
      ...update,
      box_level: 0,
      // Tomorrow, matching the other queue writes. Due dates are matched with
      // <=, so a failed ayah comes back at the next session either way; dating
      // it today only made the home screen report a mistake review as pending
      // for the rest of a day in which it could no longer run.
      next_review_date: tomorrowString(),
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

  // Tomorrow rather than today, the same rule the other two queue writes
  // follow. Due dates are matched with <=, so an item dated tomorrow is served
  // on exactly the same days as one dated today; the only difference is that it
  // no longer reports itself as due for review during the session that flagged
  // it, which is what put "Mistake Review" back on the agenda after a quiz.
  const soon = tomorrowString();

  const row = {
    user_id: userId,
    surah_number: surahNumber,
    ayah_number: ayahNumber,
    context_wrong_count: newCount,
    box_level: existing?.box_level ?? 0,
    next_review_date: existing?.next_review_date ?? soon,
  };

  if (!existing) {
    row.box_level = 0;
    row.next_review_date = soon;
  }

  if (newCount >= 2) {
    row.next_review_date = soon;
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
