// utils/windows.js
const { DateTime, Interval } = require("luxon");

// ---- classify tasks
function isAccumulative(task) {
  return !!(task.timer || task.counter);
}

// ---- window bounds in user's TZ (returns Luxon DateTimes)
function windowBounds(repeat, deadlineDate, anchor = DateTime.now(), tz = "UTC") {
  const now = anchor.setZone(tz);
  const r = String(repeat || "").toLowerCase();

  if (r === "daily") {
    const start = now.startOf("day");
    return { start, end: start.plus({ days: 1 }) };
  }
  if (r === "weekly") {
    const start = now.startOf("week"); // luxon: week starts Monday by default (ISO)
    return { start, end: start.plus({ weeks: 1 }) };
  }
  if (r === "monthly") {
    const start = now.startOf("month");
    return { start, end: start.plus({ months: 1 }) };
  }
  if (r === "yearly") {
    const start = now.startOf("year");
    return { start, end: start.plus({ years: 1 }) };
  }

  // no repeat: use today..deadline (inclusive)
  if (deadlineDate) {
    const start = now.startOf("day");
    const dl = DateTime.fromISO(String(deadlineDate).slice(0, 10), { zone: tz }).endOf("day");
    const end = dl.plus({ milliseconds: 1 }); // exclusive
    return { start, end };
  }

  // fallback to today
  const start = now.startOf("day");
  return { start, end: start.plus({ days: 1 }) };
}

// ---- sum progress in an interval (minutes + count)
async function sumProgressInInterval(db, taskId, userId, start, end) {
  const { rows } = await db.query(
    `SELECT
       COALESCE(SUM(CASE WHEN type='minutes' THEN value END), 0)::int AS minutes,
       COALESCE(SUM(CASE WHEN type='count'   THEN value END), 0)::int AS count
     FROM task_progress
    WHERE task_id = $1 AND user_id = $2
      AND at >= $3 AND at < $4`,
    [taskId, userId, start.toUTC().toISO(), end.toUTC().toISO()]
  );
  return {
    minutes: Number(rows[0]?.minutes || 0),
    count: Number(rows[0]?.count || 0),
  };
}

// ---- decide if window is “successful”
function windowSuccess({ timer, counter }, sums, threshold = 1.0) {
  // Choose semantics: "OR" if both present
  const wantMin = timer ? sums.minutes >= threshold * Number(timer) : null;
  const wantCnt = counter ? sums.count   >= threshold * Number(counter) : null;

  if (timer && counter) return Boolean(wantMin || wantCnt); // OR semantics
  if (timer) return Boolean(wantMin);
  if (counter) return Boolean(wantCnt);
  return false;
}

// ---- compute window-by-window streak ending at *current* window
async function recomputeAccumulativeStreak(db, task, userId, tz = "UTC", threshold = 1.0) {
  const now = DateTime.now().setZone(tz);
  // Build a list of windows from the earliest progress up to the current one, then scan.
  // First, find earliest progress date for this task:
  const { rows: firstRows } = await db.query(
    `SELECT MIN(at) AS first_at FROM task_progress WHERE task_id=$1 AND user_id=$2`,
    [task.id, userId]
  );
  const firstAt = firstRows[0]?.first_at;
  if (!firstAt) {
    // no progress yet – reset streak to 0 but keep best as-is
    await db.query(
      `INSERT INTO task_streaks (task_id, current_streak, best_streak, last_done_day)
       VALUES ($1, 0, 0, NULL)
       ON CONFLICT (task_id) DO UPDATE SET current_streak=0`,
      [task.id]
    );
    return { current: 0, best: 0, lastDone: null };
  }

  // Walk windows from first progress window to current window
  const first = DateTime.fromISO(firstAt).setZone(tz);
  const { start: curStart, end: curEnd } = windowBounds(task.repeat, task.deadline_date, now, tz);

  // Helper to advance a window
  const nextWindow = (s, repeat, deadline) => {
    const r = String(repeat || "").toLowerCase();
    if (r === "daily")   return { start: s.plus({ days: 1 }),     end: s.plus({ days: 2 }) };
    if (r === "weekly")  return { start: s.plus({ weeks: 1 }),    end: s.plus({ weeks: 2 }) };
    if (r === "monthly") return { start: s.plus({ months: 1 }),   end: s.plus({ months: 2 }) };
    if (r === "yearly")  return { start: s.plus({ years: 1 }),    end: s.plus({ years: 2 }) };
    // no repeat: march days until deadline
    const nStart = s.plus({ days: 1 });
    const w = windowBounds(null, deadline, nStart, s.zoneName);
    return w;
  };

  // Start at the first window that contains first progress
  let { start, end } = windowBounds(task.repeat, task.deadline_date, first, tz);
  // Clamp for no-repeat so we don’t go past the final deadline window
  const clampEnd = (task.repeat ? null : DateTime.fromISO(String(task.deadline_date || "").slice(0, 10), { zone: tz }).endOf("day").plus({ millisecond: 1 }));

  let best = 0;
  let current = 0;
  let lastDone = null;

  while (start < curEnd) {
    if (clampEnd && start >= clampEnd) break;

    const sums = await sumProgressInInterval(db, task.id, userId, start, end);
    const success = windowSuccess(task, sums, threshold);

    if (success) {
      current += 1;
      if (current > best) best = current;
      lastDone = end.minus({ milliseconds: 1 }).toISODate(); // last moment of window
    } else {
      current = 0;
    }

    // advance
    const nxt = nextWindow(start, task.repeat, task.deadline_date);
    start = nxt.start;
    end   = nxt.end;
  }

  await db.query(
    `INSERT INTO task_streaks (task_id, current_streak, best_streak, last_done_day)
     VALUES ($1, $2, $3, $4::date)
     ON CONFLICT (task_id)
     DO UPDATE SET current_streak = EXCLUDED.current_streak,
                   best_streak    = GREATEST(task_streaks.best_streak, EXCLUDED.best_streak),
                   last_done_day  = EXCLUDED.last_done_day`,
    [task.id, current, best, lastDone]
  );

  return { current, best, lastDone };
}

module.exports = {
  isAccumulative,
  windowBounds,
  sumProgressInInterval,
  windowSuccess,
  recomputeAccumulativeStreak,
};
