// routes/tasks.js
const express = require("express");
const { DateTime } = require("luxon");

module.exports = function buildTasksRoutes(users) {
  const router = express.Router();

  // Prefer req.user.id (from requireAuth). Fall back to username cookie if needed.
  async function getUserId(req) {
    if (req.user?.id) return req.user.id;

    const username = req?.cookies?.username || req?.user?.username || null;
    if (!username) return null;
    const { rows } = await users.getByUsername(username);
    return rows?.[0]?.id ?? null;
  }

  // ---------- Ensure tables (idempotent) ----------
  async function ensureSchema() {
    // progress
    await users.db.query(`
      CREATE TABLE IF NOT EXISTS task_progress (
        id        SERIAL PRIMARY KEY,
        task_id   INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        user_id   INTEGER NOT NULL,
        type      TEXT NOT NULL CHECK (type IN ('minutes','count')),
        value     INTEGER NOT NULL CHECK (value > 0),
        at        TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await users.db.query(
      `CREATE INDEX IF NOT EXISTS idx_task_progress_task_at
         ON task_progress(task_id, at)`
    );
    await users.db.query(
      `CREATE INDEX IF NOT EXISTS idx_task_progress_user_at
         ON task_progress(user_id, at)`
    );

    // day-level completions for streaks
    await users.db.query(`
      CREATE TABLE IF NOT EXISTS task_completions (
        id         BIGSERIAL PRIMARY KEY,
        task_id    BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        done_day   DATE   NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (task_id, done_day)
      );
    `);

    // streak aggregates
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

  // ---- Helper: compute the "current window" for a task (UTC) ----
  function windowBounds(task, now = new Date()) {
    const atStartOfDay = (d) => {
      const x = new Date(d);
      x.setUTCHours(0, 0, 0, 0);
      return x;
    };
    const atStartOfIsoWeek = (d) => {
      const x = atStartOfDay(d);
      const day = (x.getUTCDay() + 6) % 7; // Mon=0..Sun=6
      x.setUTCDate(x.getUTCDate() - day);
      return x;
    };
    const atStartOfMonth = (d) =>
      new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

    const rep = String(task.repeat || "").toLowerCase();
    if (rep === "daily") {
      const start = atStartOfDay(now);
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 1);
      return { start, end };
    }
    if (rep === "weekly") {
      const start = atStartOfIsoWeek(now);
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 7);
      return { start, end };
    }
    if (rep === "monthly") {
      const start = atStartOfMonth(now);
      const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
      return { start, end };
    }

    // If it has a deadline, window = today..deadline end-of-day
    if (task.deadline_date) {
      const start = atStartOfDay(now);
      const end = new Date(task.deadline_date);
      end.setUTCHours(23, 59, 59, 999);
      return { start, end };
    }

    // Default: just today.
    const start = atStartOfDay(now);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    return { start, end };
  }

  // ---- Recompute streaks from completions (same logic as habits) ----
  async function recomputeAndSaveStreaks(taskId, userTz) {
    const { rows: compRows } = await users.db.query(
      `SELECT done_day::date AS d
         FROM task_completions
        WHERE task_id = $1
        ORDER BY done_day ASC`,
      [taskId]
    );

    const days = compRows
      .map((r) => (typeof r.d === "string" ? r.d.slice(0, 10) : new Date(r.d).toISOString().slice(0, 10)))
      .filter(Boolean)
      .map((s) => DateTime.fromISO(s).startOf("day"));

    const key = (dt) => dt.toISODate();
    const doneSet = new Set(days.map(key));
    const todayLocal = DateTime.now().setZone(userTz || "UTC").startOf("day");

    // current streak ending today
    let current = 0;
    if (doneSet.has(key(todayLocal))) {
      current = 1;
      let cursor = todayLocal.minus({ days: 1 });
      while (doneSet.has(key(cursor))) {
        current += 1;
        cursor = cursor.minus({ days: 1 });
      }
    }

    // best streak overall
    let best = 0,
      run = 0,
      prev = null;
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

    return { current_streak: current, best_streak: best, last_done_day: lastDone };
  }

  // ---- LIST TASKS (augmented with *current-window* progress) ----
  router.get("/", async (req, res) => {
    try {
      const uid = await getUserId(req);
      if (!uid) return res.status(401).json({ error: "Not logged in" });

      const { rows: tasks } = await users.db.query(
        `SELECT id, user_id, activity_name, timer, counter, deadline_date, repeat
           FROM tasks
          WHERE user_id = $1
          ORDER BY id DESC`,
        [uid]
      );

      const now = new Date();
      const results = await Promise.all(
        tasks.map(async (t) => {
          const { start, end } = windowBounds(t, now);
          const { rows: sums } = await users.db.query(
            `SELECT
               COALESCE(SUM(CASE WHEN type='minutes' THEN value END), 0)::int AS progress_minutes,
               COALESCE(SUM(CASE WHEN type='count'   THEN value END), 0)::int AS progress_count
             FROM task_progress
            WHERE task_id = $1
              AND user_id = $2
              AND at >= $3 AND at < $4`,
            [t.id, uid, start.toISOString(), end.toISOString()]
          );
          const pm = sums[0].progress_minutes || 0;
          const pc = sums[0].progress_count || 0;

          return {
            id: t.id,
            activityName: t.activity_name,
            timer: t.timer,
            counter: t.counter,
            deadlineDate: t.deadline_date,
            repeat: t.repeat,
            progressMinutes: pm,
            progressCount: pc,
            completeTimer: t.timer ? pm >= Number(t.timer) : null,
            completeCounter: t.counter ? pc >= Number(t.counter) : null,
          };
        })
      );

      res.json(results);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to load tasks" });
    }
  });

  // ---- CREATE TASK ----
  router.post("/createTask", async (req, res) => {
    try {
      const uid = await getUserId(req);
      if (!uid) return res.status(401).json({ error: "Not logged in" });

      const { activityName, timer, counter, deadline, repeat } = req.body || {};
      if (!activityName || (!timer && !counter)) {
        return res
          .status(400)
          .json({ error: "activityName and (timer or counter) required" });
      }

      const { rows } = await users.db.query(
        `INSERT INTO tasks (user_id, activity_name, timer, counter, deadline_date, repeat)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [uid, activityName, timer || null, counter || null, deadline || null, repeat || null]
      );

      res.json({ ok: true, id: rows[0].id });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to create task" });
    }
  });

  // ---- DELETE TASK ----
  router.delete("/:id", async (req, res) => {
    try {
      const uid = await getUserId(req);
      if (!uid) return res.status(401).json({ error: "Not logged in" });

    const id = Number(req.params.id);
      if (!id) return res.status(400).json({ error: "Bad id" });

      const { rowCount } = await users.db.query(
        `DELETE FROM tasks WHERE id = $1 AND user_id = $2`,
        [id, uid]
      );
      if (rowCount === 0) return res.status(404).json({ error: "Not found" });

      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to delete task" });
    }
  });

  // ---- ADD PROGRESS (and update streaks if we just hit 100%) ----
  // Body: { type: 'minutes'|'count', value: number (>0), at?: ISOString, tz?: IANA }
  // Returns: { ok: true, totals: { minutes, count }, streak?: {...} }
  router.post("/:id/progress", async (req, res) => {
    try {
      const uid = await getUserId(req);
      if (!uid) return res.status(401).json({ error: "Not logged in" });

      const id = Number(req.params.id);
      const { type, value, at, tz } = req.body || {};
      const userTz = tz || "UTC";

      if (!id || (type !== "minutes" && type !== "count"))
        return res.status(400).json({ error: "Bad payload" });

      const v = Number(value);
      if (!Number.isFinite(v) || v <= 0)
        return res.status(400).json({ error: "Value must be > 0" });

      // Validate ownership + metric presence on task
      const { rows: taskRows } = await users.db.query(
        `SELECT id, user_id, timer, counter, repeat, deadline_date
           FROM tasks
          WHERE id = $1 AND user_id = $2`,
        [id, uid]
      );
      const task = taskRows[0];
      if (!task) return res.status(404).json({ error: "Task not found" });
      if (type === "minutes" && !task.timer)
        return res.status(400).json({ error: "Task has no timer target" });
      if (type === "count" && !task.counter)
        return res.status(400).json({ error: "Task has no counter target" });

      // Insert progress row
      const atTs = at ? new Date(at) : new Date();
      await users.db.query(
        `INSERT INTO task_progress (task_id, user_id, type, value, at)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, uid, type, v, atTs.toISOString()]
      );

      // Totals across all time (for UI)
      const { rows: sumsAll } = await users.db.query(
        `SELECT
           COALESCE(SUM(CASE WHEN type='minutes' THEN value END), 0)::int AS minutes,
           COALESCE(SUM(CASE WHEN type='count'   THEN value END), 0)::int AS count
         FROM task_progress
        WHERE task_id = $1 AND user_id = $2`,
        [id, uid]
      );

      // Check if the *current window* is now complete
      const { start, end } = windowBounds(task, atTs);
      const { rows: sumsWindow } = await users.db.query(
        `SELECT
           COALESCE(SUM(CASE WHEN type='minutes' THEN value END), 0)::int AS pm,
           COALESCE(SUM(CASE WHEN type='count'   THEN value END), 0)::int AS pc
         FROM task_progress
        WHERE task_id = $1
          AND user_id = $2
          AND at >= $3 AND at < $4`,
        [id, uid, start.toISOString(), end.toISOString()]
      );
      const pm = sumsWindow[0].pm || 0;
      const pc = sumsWindow[0].pc || 0;

      const timerTarget = task.timer ? Number(task.timer) : null;
      const counterTarget = task.counter ? Number(task.counter) : null;

      let streak = null;

      // If we've reached the target for the active metric(s), mark today complete and recompute streaks
      const timerDone = timerTarget ? pm >= timerTarget : false;
      const countDone = counterTarget ? pc >= counterTarget : false;
      const nowLocalDay = DateTime.fromJSDate(atTs).setZone(userTz).toISODate();

      if (timerDone || countDone) {
        // Mirror completion at the day granularity (today in user's tz)
        await users.db.query(
          `INSERT INTO task_completions (task_id, done_day)
             VALUES ($1, $2::date)
           ON CONFLICT (task_id, done_day) DO NOTHING`,
          [id, nowLocalDay]
        );

        // Ensure streak row exists
        await users.db.query(
          `INSERT INTO task_streaks (task_id) VALUES ($1)
           ON CONFLICT (task_id) DO NOTHING`,
          [id]
        );

        // Recompute streaks
        streak = await recomputeAndSaveStreaks(id, userTz);
      }

      res.json({
        ok: true,
        totals: { minutes: sumsAll[0].minutes, count: sumsAll[0].count },
        ...(streak ? { streak } : {}),
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to log progress" });
    }
  });

  // ---- PROGRESS SUMMARY (for your UI card) ----
  // GET /tasks/:id/progress/summary
  // Returns totals across all time: { minutes, count }
  router.get("/:id/progress/summary", async (req, res) => {
    try {
      const uid = await getUserId(req);
      if (!uid) return res.status(401).json({ error: "Not logged in" });

      const id = Number(req.params.id);
      if (!id) return res.status(400).json({ error: "Bad task id" });

      // Optional: ensure task belongs to user
      const { rows: trows } = await users.db.query(
        `SELECT id FROM tasks WHERE id = $1 AND user_id = $2`,
        [id, uid]
      );
      if (!trows[0]) return res.status(404).json({ error: "Task not found" });

      const { rows } = await users.db.query(
        `SELECT
           COALESCE(SUM(CASE WHEN type='minutes' THEN value END), 0)::int AS minutes,
           COALESCE(SUM(CASE WHEN type='count'   THEN value END), 0)::int AS count
         FROM task_progress
        WHERE task_id = $1 AND user_id = $2`,
        [id, uid]
      );

      res.json({ minutes: rows[0].minutes, count: rows[0].count });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to load progress summary" });
    }
  });

  return router;
};
