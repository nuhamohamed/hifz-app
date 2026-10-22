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

/**
 * The ayahs a question is recited over: two before the one being tested and
 * one after. The end can run one past the last ayah of a surah; whoever loads
 * the text stops at the real end.
 */
export function quizContextRange(item) {
  return { start: Math.max(1, item.ayah_number - 2), end: item.ayah_number + 1 };
}

/**
 * Groups the due questions so that no ayah is recited twice.
 *
 * Questions whose ayahs overlap or run straight on are one stretch, recited
 * once, with each target inside it still scored on its own. A group sits in
 * the queue where its first question sat, so the order is otherwise kept,
 * weakest first; inside a group the questions go in mushaf order, because
 * that is the order they are recited in.
 *
 * This replaces a dedupe that dropped any question within three ayahs of one
 * already kept. The dropped ones stayed due, so they surfaced as soon as their
 * neighbour was answered: after a pause the total went up and the review
 * opened on ayahs that had just been recited.
 *
 * @returns {{ surah: number, start: number, end: number, items: object[] }[]}
 */
export function groupQuizRuns(items) {
  const groups = [];
  const touches = (g, surah, start, end) =>
    g.surah === surah && start <= g.end + 1 && end >= g.start - 1;

  for (const item of items) {
    const { start, end } = quizContextRange(item);
    let home = groups.find((g) => touches(g, item.surah_number, start, end));
    if (!home) {
      groups.push({ surah: item.surah_number, start, end, items: [item] });
      continue;
    }
    home.start = Math.min(home.start, start);
    home.end = Math.max(home.end, end);
    home.items.push(item);

    // Widening a group can make it reach a later one. Fold those in, so one
    // ayah never ends up in two groups.
    for (let i = groups.length - 1; i >= 0; i -= 1) {
      const other = groups[i];
      if (other === home || !touches(home, other.surah, other.start, other.end)) continue;
      home.start = Math.min(home.start, other.start);
      home.end = Math.max(home.end, other.end);
      home.items.push(...other.items);
      groups.splice(i, 1);
    }
  }

  for (const g of groups) g.items.sort((a, b) => a.ayah_number - b.ayah_number);
  return groups;
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

export async function fetchDueQuizItems(userId, onDate) {
  // Dated, so the session summary can cost tomorrow's review the same way the
  // agenda costs today's. The portion is sized against whatever the quiz takes,
  // so previewing with today's due list would name a portion tomorrow re-cuts.
  const today = onDate ?? getTodayDateString();

  const { data, error } = await supabase
    .from('quiz_queue')
    .select('id, surah_number, ayah_number, box_level, lapses')
    .eq('user_id', userId)
    .lte('next_review_date', today)
    .order('box_level', { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return capLeeches(data ?? []);
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
 * Put a finished session's recitation mistakes into the review queue, due
 * tomorrow, so they come back in the Mistake Review on later days.
 *
 * The recap quiz used to do this as it started. It is gone, so scoring does it
 * instead, which runs after the summary screen's corrections: a mistake the
 * person cleared as a misflag is no longer queued, where the recap queued it
 * before they had the chance to say so.
 *
 * @param {string} userId
 * @param {string} sessionId
 */
export async function queueSessionMistakes(userId, sessionId) {
  const { data: mistakes, error: mistakesError } = await supabase
    .from('mistakes')
    .select('surah_number, ayah_number')
    .eq('user_id', userId)
    .eq('session_id', sessionId)
    // Recitation only. Review mistakes are written to the same table so the
    // summary can offer them for correction, but an ayah that came up in the
    // Mistake Review already has its place in the queue.
    .eq('source', 'recitation')
    .is('dismissed_at', null);

  if (mistakesError) {
    throw new Error(mistakesError.message);
  }

  // One row per ayah, however many words in it were wrong.
  const keys = new Map();
  for (const m of mistakes ?? []) {
    keys.set(`${m.surah_number}:${m.ayah_number}`, m);
  }
  if (keys.size === 0) return;

  // Tomorrow, not today: dated today they would be due for a Mistake Review
  // on the same day they were made.
  const rows = [...keys.values()].map((m) => ({
    user_id: userId,
    surah_number: m.surah_number,
    ayah_number: m.ayah_number,
    box_level: 0,
    next_review_date: tomorrowString(),
  }));

  const { error } = await supabase
    .from('quiz_queue')
    .upsert(rows, { onConflict: 'user_id,surah_number,ayah_number' });

  if (error) {
    throw new Error(error.message);
  }
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
export async function dueQuizCost(db, userId, minutesPerPage, onDate, prefetchedItems) {
  // The Today screen fetches the due items alongside everything else it asks
  // for, rather than waiting for them here, and passes them in.
  const items = prefetchedItems ?? (await fetchDueQuizItems(userId, onDate));
  if (!items.length) return { items, minutes: 0 };

  // Costed by what is actually recited: each group of questions once over its
  // whole stretch (see groupQuizRuns), not each target ayah alone. Costing the
  // target alone put the review at about a quarter of its real length, and the
  // portion, which gets whatever time the review leaves, came out that much
  // too long. An ayah past the end of a surah is not in the mushaf database,
  // so it costs nothing, which is right.
  const runs = groupQuizRuns(items);
  const refs = runs.flatMap((run) => {
    const list = [];
    for (let a = run.start; a <= run.end; a += 1) list.push({ surah: run.surah, ayah: a });
    return list;
  });
  const shares = await getAyahPageShares(db, refs);

  // Each run's recitation is spread over its questions, so the per-item costs
  // still add up to the whole. If the database knows none of a run's ayahs,
  // fall back to the average ayah rather than costing nothing.
  const costed = runs.flatMap((run) => {
    let total = 0;
    let found = 0;
    for (let a = run.start; a <= run.end; a += 1) {
      const v = shares.get(`${run.surah}:${a}`);
      if (v != null) {
        total += v;
        found += 1;
      }
    }
    if (found === 0) total = (run.end - run.start + 1) / 10.3;
    return run.items.map((i) => ({ ...i, pageShare: total / run.items.length }));
  });

  return { items: costed, minutes: quizMinutes(costed, minutesPerPage) };
}

/**
 * How many review questions have been answered today.
 *
 * Answering moves an item's due date past today, so it leaves the due list.
 * The review screen adds this to its numbering so that a session resumed after
 * a pause carries on from Q 9 rather than starting again at Q 1.
 *
 * "Today" is the phone's day: rows answered since local midnight that are no
 * longer due.
 */
export async function countAnsweredToday(userId) {
  const now = new Date();
  const localMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const { count, error } = await supabase
    .from('quiz_queue')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('updated_at', localMidnight.toISOString())
    .gt('next_review_date', getTodayDateString())
    .not('last_result', 'is', null);
  if (error) return 0;
  return count ?? 0;
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

  // Handed back so a wrong answer can be recorded with the position it cost. By
  // the time anyone disputes that answer on the summary this row has been
  // overwritten, and both of these are gone: the box level is what clearing the
  // mistake promotes from, and the date is what undoing that clear restores.
  return {
    previousBoxLevel: item.box_level,
    previousNextReviewDate: item.next_review_date,
  };
}

/**
 * Clears a Mistake Review failure that the person says never happened.
 *
 * Not a restore. An ayah only reaches 'wrong' after failing the first attempt,
 * the retry and the read-back, so someone clearing that is saying the recogniser
 * misheard them throughout — which is to say they had it right the first time.
 * Putting the item back where it started would still cost them the promotion
 * that a correct first attempt earns, and go on costing it every time the
 * recogniser slipped. So this applies what 'correct_first' would have applied.
 *
 * That is also the standard the rest of the app already holds dismissal to:
 * clearing a recitation mistake drops the ayah out of the review queue
 * altogether. Advancing one box is the smaller trust, not the larger one.
 *
 * The lapse goes back too. It was counted against an answer that was never
 * wrong, and lapses are what LEECH_THRESHOLD reads to decide an ayah is a
 * problem worth limiting.
 *
 * @param {string} userId
 * @param {number} surahNumber
 * @param {number} ayahNumber
 * @param {number|null} previousBoxLevel where the item stood before the failed
 *   answer demoted it. Null on rows written before this was recorded, where the
 *   current level is the only base available.
 */
export async function clearReviewMistake(userId, surahNumber, ayahNumber, previousBoxLevel) {
  const today = getTodayDateString();

  const { data: item, error: fetchError } = await supabase
    .from('quiz_queue')
    .select('id, box_level, times_correct_first, lapses')
    .eq('user_id', userId)
    .eq('surah_number', surahNumber)
    .eq('ayah_number', ayahNumber)
    .maybeSingle();

  if (fetchError) {
    throw new Error(fetchError.message);
  }

  // The queue row can legitimately be gone: the ayah may have been cleared by
  // another correction, or removed outright. Nothing to put right.
  if (!item) return;

  const base = previousBoxLevel ?? item.box_level ?? 0;
  const newBoxLevel = Math.min(base + 1, 5);

  const { error: updateError } = await supabase
    .from('quiz_queue')
    .update({
      box_level: newBoxLevel,
      next_review_date: nextReviewDateForBox(newBoxLevel, today),
      times_correct_first: (item.times_correct_first ?? 0) + 1,
      lapses: Math.max(0, (item.lapses ?? 0) - 1),
      last_result: 'correct_first',
      updated_at: new Date().toISOString(),
    })
    .eq('id', item.id);

  if (updateError) {
    throw new Error(updateError.message);
  }
}

/**
 * Puts back what `clearReviewMistake` moved, for the undo on the summary.
 *
 * Not a second guess at the schedule: it writes back the exact position the
 * ayah held before the review failure, which is why `review_prev_next_date` is
 * recorded alongside the box level. Deriving a date from the box instead would
 * quietly push a due ayah days out, which is the opposite of undoing anything.
 *
 * The lapse and the first-time-correct count go back the way they came, so a
 * clear and an undo of it leave no trace between them.
 *
 * @param {string} userId
 * @param {number} surahNumber
 * @param {number} ayahNumber
 * @param {number|null} previousBoxLevel box level to restore
 * @param {string|null} previousNextReviewDate review date to restore
 */
export async function restoreReviewMistake(
  userId,
  surahNumber,
  ayahNumber,
  previousBoxLevel,
  previousNextReviewDate
) {
  const { data: item, error: fetchError } = await supabase
    .from('quiz_queue')
    .select('id, box_level, times_correct_first, lapses')
    .eq('user_id', userId)
    .eq('surah_number', surahNumber)
    .eq('ayah_number', ayahNumber)
    .maybeSingle();

  if (fetchError) {
    throw new Error(fetchError.message);
  }
  if (!item) return;

  const { error: updateError } = await supabase
    .from('quiz_queue')
    .update({
      box_level: previousBoxLevel ?? item.box_level,
      next_review_date: previousNextReviewDate ?? tomorrowString(),
      times_correct_first: Math.max(0, (item.times_correct_first ?? 0) - 1),
      lapses: (item.lapses ?? 0) + 1,
      last_result: 'wrong',
      updated_at: new Date().toISOString(),
    })
    .eq('id', item.id);

  if (updateError) {
    throw new Error(updateError.message);
  }
}

/**
 * Puts an ayah back in the review queue after an undone recitation misflag.
 *
 * Box 0 due tomorrow, which is exactly what the mistake put there in the first
 * place, so this restores rather than invents.
 */
export async function restoreRecitationMistake(userId, surahNumber, ayahNumber) {
  const { error } = await supabase.from('quiz_queue').upsert(
    {
      user_id: userId,
      surah_number: surahNumber,
      ayah_number: ayahNumber,
      box_level: 0,
      next_review_date: tomorrowString(),
    },
    { onConflict: 'user_id,surah_number,ayah_number' }
  );

  if (error) {
    throw new Error(error.message);
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

  // What the row was before, so the slip can be recorded with it and clearing
  // the slip on the summary can put the queue back exactly. Box and date are
  // null when the ayah was not in the queue at all.
  return {
    previousBoxLevel: existing ? existing.box_level : null,
    previousNextReviewDate: existing ? existing.next_review_date : null,
    previousContextCount: existing?.context_wrong_count ?? 0,
  };
}

/**
 * Undo a context-ayah slip cleared on the summary.
 *
 * The slip added the ayah to the queue, or bumped its context count and, on a
 * second slip, sent it back to box 0. Clearing puts back what it changed: an
 * ayah it added is taken out again, unless it has since been asked as a
 * question in its own right, and one that was already there gets its box,
 * date and count back.
 */
export async function clearContextMistake(userId, surahNumber, ayahNumber, previous) {
  const { data: item, error: fetchError } = await supabase
    .from('quiz_queue')
    .select('id, last_result')
    .eq('user_id', userId)
    .eq('surah_number', surahNumber)
    .eq('ayah_number', ayahNumber)
    .maybeSingle();

  if (fetchError) throw new Error(fetchError.message);
  if (!item) return;

  const wasQueued = previous?.previousBoxLevel != null;
  if (!wasQueued && item.last_result == null) {
    const { error } = await supabase.from('quiz_queue').delete().eq('id', item.id);
    if (error) throw new Error(error.message);
    return;
  }

  const update = { context_wrong_count: previous?.previousContextCount ?? 0 };
  if (wasQueued) {
    update.box_level = previous.previousBoxLevel;
    update.next_review_date = previous.previousNextReviewDate ?? tomorrowString();
  }
  const { error } = await supabase.from('quiz_queue').update(update).eq('id', item.id);
  if (error) throw new Error(error.message);
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
