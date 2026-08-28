/**
 * One definition of "today" for the whole app.
 *
 * There used to be five copies of this, and two of them used UTC while the rest
 * used the phone's local date. For anyone east of London that means the app
 * disagreed with itself about what day it was for part of every day: the quiz
 * engine could call it tomorrow while the planner still called it today, so a
 * quiz already finished came back, or a portion was scheduled into a day that
 * had not arrived. In the Gulf, +4, that window is the four hours before
 * midnight; in Malaysia, +8, it is eight.
 *
 * Local is the right choice, not UTC. "Today" to a person means the day they
 * are living in, and a revision app is built around their day. The consequence
 * to be aware of: someone who crosses time zones may see a day count as
 * slightly longer or shorter, which is the correct trade against the app being
 * wrong for everyone in the east every single evening.
 *
 * Dates are stored as `YYYY-MM-DD` strings rather than timestamps, which is why
 * these are string helpers. Postgres `date` columns compare them directly.
 */

/** Today, in the phone's own time zone, as `YYYY-MM-DD`. */
export function todayString(now = new Date()) {
  return format(now);
}

/** Tomorrow, in the phone's own time zone. */
export function tomorrowString(now = new Date()) {
  return addDays(format(now), 1);
}

/**
 * Shifts a `YYYY-MM-DD` string by whole days, staying in local time.
 *
 * Built by hand from the parts rather than parsing the string, because
 * `new Date('2026-08-27')` is interpreted as UTC midnight while
 * `new Date(2026, 7, 27)` is local midnight. Mixing those is how the two
 * definitions drifted apart in the first place.
 */
export function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return format(date);
}

function format(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Whole days from one `YYYY-MM-DD` to another, positive when `to` is later.
 *
 * Built from local midnights for the same reason addDays() is, and rounded
 * because a daylight-saving boundary makes one of the days 23 or 25 hours long
 * and would otherwise leave a fraction.
 */
export function daysBetween(from, to) {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const a = new Date(fy, fm - 1, fd);
  const b = new Date(ty, tm - 1, td);
  return Math.round((b - a) / 86400000);
}
