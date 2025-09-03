// routes/habits.js
const express = require("express");
const { DateTime } = require("luxon");

// Accepts a JS Date, a Luxon DateTime, or a 'YYYY-MM-DD' string from pg
function asISODateString(x) {
  if (!x) return null;
  if (typeof x === "string") return x.slice(0, 10);
  if (x instanceof Date) return x.toISOString().slice(0, 10);
  if (typeof x.toISODate === "function") return x.toISODate();
  const d = new Date(x);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}

/**
 * Exposes:
 *   GET  /habits/day?date=YYYY-MM-DD&userId=123
 *   PUT  /habits/:taskId/complete   { userId, date, completed, tz? }
 *
 * Notes:
 * - Completion is computed from task_progress within the task's window.
 * - We also mirror day-level completion into task_completions(done_day),
 *   then recompute task_streaks atomically (current, best, last_done_day).
 *
 * Mount with auth:
 *   app.use("/habits", requireAuth, habitsRouter);
 */
module.exports = function buildHabitsRoutes(users) {
  const router = express.Router();

  // ---------- one-time schema guard (idempotent) ----------
  async function ensureSchema() {
    await users.db.query(`
      CREATE TABLE IF NOT EXISTS task_completions (
        id         BIGSERIAL PRIMARY KEY,
        task_id    BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        done_day   DATE   NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (task_id, done_day)
      );
    `);

    await users.db.query(`
      CREATE TABLE IF NOT EXISTS task_streaks (
        task_id        BIGINT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
        current_streak INT NOT NULL DEFAULT 0,
        best_streak    INT NOT NULL DEFAULT 0,
        last_done_day  DATE
      );
    `);
  }
  ensureSchema().catch(console.error);

  // -------- window helpers (UTC-normalized) --------
  function atUTCDate(d) {
    if (typeof d === "string") {
      const [y, m, day] = d.split("-").map(Number);
      return new Date(Date.UTC(y, m - 1, day));
    }
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }

  function boundsForDay(dateStr) {
    const d0 = atUTCDate(dateStr);
    const d1 = new Date(d0);
    d1.setUTCDate(d1.getUTCDate() + 1);
    return { start: d0, end: d1 };
  }

  function boundsForIsoWeek(dateStr) {
    const d = atUTCDate(dateStr);
    // Monday start
    const day = (d.getUTCDay() + 6) % 7; // 0..6 with Mon=0
    const start = new Date(d);
    start.setUTCDate(start.getUTCDate() - day);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);
    return { start, end };
  }

  function boundsForMonth(dateStr) {
    const d = atUTCDate(dateStr);
    const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    const end   = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    return { start, end };
  }

  function windowBoundsForTaskOnDate(task, dateStr) {
    const rep = String(task.repeat || "").toLowerCase();
    if (rep === "daily")   return boundsForDay(dateStr);
    if (rep === "weekly")  return boundsForIsoWeek(dateStr);
    if (rep === "monthly") return boundsForMonth(dateStr);

    if (task.deadline_date) {
      const { start } = boundsForDay(dateStr);
      const end = new Date(task.deadline_date);
      end.setUTCHours(23, 59, 59, 999);
      return { start, end };
    }
    return boundsForDay(dateStr);
  }

  // ---------- streak helpers ----------
  async function ensureStreakRow(taskId) {
    await users.db.query(
      `INSERT INTO task_streaks (task_id, current_streak, best_streak, last_done_day)
       VALUES ($1, 0, 0, NULL)
       ON CONFLICT (task_id) DO NOTHING`,
      [taskId]
    );
  }

  async function recomputeAndSaveStreaks(taskId, userTz) {
    const { rows: compRows } = await users.db.query(
      `SELECT done_day::date AS d
         FROM task_completions
        WHERE task_id = $1
        ORDER BY done_day ASC`,
      [taskId]
    );

    const days = compRows
      .map(r => asISODateString(r.d))
      .filter(Boolean)
      .map(s => DateTime.fromISO(s).startOf("day"));

    const key = (dt) => dt.toISODate();
    const doneSet = new Set(days.map(key));
    const todayLocal = DateTime.now().setZone(userTz || "UTC").startOf("day");

    // Current streak: consecutive run ending today
    let current = 0;
    if (doneSet.has(key(todayLocal))) {
      current = 1;
      let cursor = todayLocal.minus({ days: 1 });
      while (doneSet.has(key(cursor))) {
        current += 1;
        cursor = cursor.minus({ days: 1 });
      }
    } else {
      current = 0;
    }

    // Best streak: longest consecutive run in history
    let best = 0;
    let run = 0;
    let prev = null;
    for (const d of days) {
      if (!prev) run = 1;
      else run = d.diff(prev, "days").days === 1 ? run + 1 : 1;
      if (run > best) best = run;
      prev = d;
    }

    const lastDone = days.length ? days[days.length - 1].toISODate() : null;

    await users.db.query(
      `INSERT INTO task_streaks (task_id, current_streak, best_streak, last_done_day)
       VALUES ($1, $2, $3, $4::date)
       ON CONFLICT (task_id)
       DO UPDATE SET current_streak = EXCLUDED.current_streak,
                     best_streak    = EXCLUDED.best_streak,
                     last_done_day  = EXCLUDED.last_done_day`,
      [taskId, current, best, lastDone]
    );

    return { current, best, lastDone };
  }

  // -------- GET /habits/day --------
  router.get("/day", async (req, res) => {
    try {
      const { date, userId } = req.query || {};
      if (!date) return res.status(400).json({ error: "Missing date" });
      const uid = Number(userId) || null;
      if (!uid) return res.status(400).json({ error: "Missing userId" });

      // 🔹 Include created_at so we can enforce lower bound
      const { rows: tasks } = await users.db.query(
        `SELECT id, activity_name, timer, counter, deadline_date, repeat, created_at
           FROM tasks
          WHERE user_id = $1
          ORDER BY id DESC`,
        [uid]
      );

      const out = [];
      for (const t of tasks) {
        // ---------------- Scheduling window checks ----------------
        // Normalize selected/created/deadline to UTC "date"
        const selDay = atUTCDate(date); // selected day
        let scheduled = false;

        const rep = String(t.repeat || "").toLowerCase();
        if (rep === "daily" || rep === "weekly" || rep === "monthly") {
          scheduled = true;
        } else if (t.deadline_date) {
          const dlDay = atUTCDate(asISODateString(t.deadline_date));
          scheduled = selDay <= dlDay;
        }

        // Lower bound: DO NOT show before created_at day (if present)
        if (scheduled && t.created_at) {
          const createdDay = atUTCDate(asISODateString(t.created_at));
          if (selDay < createdDay) scheduled = false;
        }

        // Upper bound: DO NOT show after deadline (if present)
        if (scheduled && t.deadline_date) {
          const dlDay = atUTCDate(asISODateString(t.deadline_date));
          if (selDay > dlDay) scheduled = false;
        }

        if (!scheduled) continue;
        // -----------------------------------------------------------

        // Now compute completion in the task's window for this selected day
        const { start, end } = windowBoundsForTaskOnDate(t, date);

        const { rows: pr } = await users.db.query(
          `SELECT
             COALESCE(SUM(CASE WHEN type='minutes' THEN value END), 0)::int AS pm,
             COALESCE(SUM(CASE WHEN type='count'   THEN value END), 0)::int AS pc
           FROM task_progress
          WHERE task_id = $1
            AND user_id = $2
            AND at >= $3 AND at < $4`,
          [t.id, uid, start.toISOString(), end.toISOString()]
        );
        const pm = pr[0].pm || 0;
        const pc = pr[0].pc || 0;

        const timerTarget   = t.timer   ? Number(t.timer)   : null;
        const counterTarget = t.counter ? Number(t.counter) : null;

        const timerDone   = timerTarget   ? pm >= timerTarget   : null;
        const counterDone = counterTarget ? pc >= counterTarget : null;

        const completed =
          (timerTarget   ? timerDone   : false) ||
          (counterTarget ? counterDone : false);

        out.push({
          task_id: t.id,
          activity_name: t.activity_name,
          completed,
          progress_minutes: pm,
          progress_count: pc,
          timer: timerTarget,
          counter: counterTarget,
          repeat: t.repeat,
          deadline_date: t.deadline_date,
          created_at: t.created_at, // returned for debugging/clients if needed
        });
      }

      res.json({ date, rows: out });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to load habits for day" });
    }
  });

  // -------- PUT /habits/:taskId/complete --------
  // Toggle completion for the selected date:
  // - Push missing progress to hit targets OR delete progress in the window
  // - Mirror the day completion into task_completions
  // - Recompute and persist streaks in the same transaction
  router.put("/:taskId/complete", async (req, res) => {
    try {
      const taskId = Number(req.params.taskId);
      const { userId, date, completed, tz } = req.body || {};
      const uid = Number(userId) || null;
      const userTz = tz || "UTC";

      if (!taskId || !uid || !date || typeof completed !== "boolean") {
        return res.status(400).json({ error: "Bad payload" });
      }

      await users.db.query("BEGIN");

      // Lock the task row (ownership + prevents concurrent metadata changes)
      const { rows: tr } = await users.db.query(
        `SELECT id, user_id, timer, counter, repeat, deadline_date
           FROM tasks
          WHERE id = $1 AND user_id = $2
          FOR UPDATE`,
        [taskId, uid]
      );
      const task = tr[0];
      if (!task) {
        await users.db.query("ROLLBACK");
        return res.status(404).json({ error: "Task not found" });
      }

      const { start, end } = windowBoundsForTaskOnDate(task, date);

      // NOTE: Do NOT add FOR UPDATE to aggregate queries (Postgres forbids it)
      const { rows: pr } = await users.db.query(
        `SELECT
           COALESCE(SUM(CASE WHEN type='minutes' THEN value END), 0)::int AS pm,
           COALESCE(SUM(CASE WHEN type='count'   THEN value END), 0)::int AS pc
         FROM task_progress
        WHERE task_id = $1
          AND user_id = $2
          AND at >= $3 AND at < $4`,
        [taskId, uid, start.toISOString(), end.toISOString()]
      );
      const pm = pr[0].pm || 0;
      const pc = pr[0].pc || 0;

      const timerTarget   = task.timer   ? Number(task.timer)   : null;
      const counterTarget = task.counter ? Number(task.counter) : null;

      if (completed) {
        if (timerTarget && pm < timerTarget) {
          const addMin = timerTarget - pm;
          await users.db.query(
            `INSERT INTO task_progress (task_id, user_id, type, value, at)
             VALUES ($1, $2, 'minutes', $3, $4)`,
            [taskId, uid, addMin, start.toISOString()]
          );
        }
        if (counterTarget && pc < counterTarget) {
          const addCnt = counterTarget - pc;
          await users.db.query(
            `INSERT INTO task_progress (task_id, user_id, type, value, at)
             VALUES ($1, $2, 'count', $3, $4)`,
            [taskId, uid, addCnt, start.toISOString()]
          );
        }

        await users.db.query(
          `INSERT INTO task_completions (task_id, done_day)
           VALUES ($1, $2::date)
           ON CONFLICT (task_id, done_day) DO NOTHING`,
          [taskId, date]
        );
      } else {
        await users.db.query(
          `DELETE FROM task_progress
            WHERE task_id = $1
              AND user_id = $2
              AND at >= $3 AND at < $4`,
          [taskId, uid, start.toISOString(), end.toISOString()]
        );

        await users.db.query(
          `DELETE FROM task_completions
            WHERE task_id = $1 AND done_day = $2::date`,
          [taskId, date]
        );
      }

      // Ensure streak row exists, then recompute from completions
      await users.db.query(
        `INSERT INTO task_streaks (task_id) VALUES ($1)
         ON CONFLICT (task_id) DO NOTHING`,
        [taskId]
      );

      const { rows: compRows } = await users.db.query(
        `SELECT done_day::date AS d
           FROM task_completions
          WHERE task_id = $1
          ORDER BY done_day ASC`,
        [taskId]
      );

      const days = compRows
        .map(r => asISODateString(r.d))
        .filter(Boolean)
        .map(s => DateTime.fromISO(s).startOf("day"));

      const key = (dt) => dt.toISODate();
      const doneSet = new Set(days.map(key));
      const todayLocal = DateTime.now().setZone(userTz).startOf("day");

      let current = 0;
      if (doneSet.has(key(todayLocal))) {
        current = 1;
        let cursor = todayLocal.minus({ days: 1 });
        while (doneSet.has(key(cursor))) {
          current += 1;
          cursor = cursor.minus({ days: 1 });
        }
      }

      let best = 0, run = 0, prev = null;
      for (const d of days) {
        if (!prev) run = 1;
        else run = d.diff(prev, "days").days === 1 ? run + 1 : 1;
        if (run > best) best = run;
        prev = d;
      }

      const lastDone = days.length ? days[days.length - 1].toISODate() : null;

      await users.db.query(
        `UPDATE task_streaks
           SET current_streak = $2,
               best_streak    = $3,
               last_done_day  = $4::date
         WHERE task_id = $1`,
        [taskId, current, best, lastDone]
      );

      await users.db.query("COMMIT");
      res.json({ ok: true, streak: { current_streak: current, best_streak: best, last_done_day: lastDone } });
    } catch (e) {
      try { await users.db.query("ROLLBACK"); } catch {}
      console.error(e);
      res.status(500).json({ error: "Failed to toggle habit completion" });
    }
  });

  return router;
};
