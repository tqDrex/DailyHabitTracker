// routes/tasks.js
const express = require("express");

module.exports = function buildTasksRoutes(users) {
  const router = express.Router();

  // Helper: get logged-in user id (requireAuth should set username cookie)
  async function getUserId(req) {
    const username = req?.cookies?.username || req?.user?.username || null;
    if (!username) return null;
    const { rows } = await users.getByUsername(username);
    return rows?.[0]?.id ?? null;
  }

  // Ensure progress table (safe to run repeatedly)
  async function ensureProgressSchema() {
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
    await users.db.query(`CREATE INDEX IF NOT EXISTS idx_task_progress_task_at ON task_progress(task_id, at);`);
    await users.db.query(`CREATE INDEX IF NOT EXISTS idx_task_progress_user_at ON task_progress(user_id, at);`);
  }
  ensureProgressSchema().catch(console.error);

  // --- Utility: compute current window bounds for a task (UTC) ---
  function windowBounds(task, now = new Date()) {
    const n = new Date(now);
    const start = new Date(n);
    const end = new Date(n);

    // daily
    const atStartOfDay = (d) => { d.setUTCHours(0,0,0,0); return d; };
    // week (ISO) -> Monday start: move to Monday
    const atStartOfIsoWeek = (d) => {
      const copy = new Date(d); copy.setUTCHours(0,0,0,0);
      // 0=Sun 1=Mon ... ; convert to Mon=0
      const day = (copy.getUTCDay() + 6) % 7;
      copy.setUTCDate(copy.getUTCDate() - day);
      return copy;
    };
    // month
    const atStartOfMonth = (d) => { const c=new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); return c; };

    const rep = (task.repeat || "").toLowerCase();
    if (rep === "daily") {
      const s = atStartOfDay(start);
      const e = new Date(s); e.setUTCDate(e.getUTCDate() + 1);
      return { start: s, end: e };
    } else if (rep === "weekly") {
      const s = atStartOfIsoWeek(start);
      const e = new Date(s); e.setUTCDate(e.getUTCDate() + 7);
      return { start: s, end: e };
    } else if (rep === "monthly") {
      const s = atStartOfMonth(start);
      const e = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 1, 1));
      return { start: s, end: e };
    } else if (task.deadline_date) {
      const s = atStartOfDay(start);
      const e = new Date(task.deadline_date);
      e.setUTCHours(23,59,59,999); // inclusive
      return { start: s, end: e };
    } else {
      // default to today
      const s = atStartOfDay(start);
      const e = new Date(s); e.setUTCDate(e.getUTCDate() + 1);
      return { start: s, end: e };
    }
  }

  // --- EXISTING: List tasks (augmented with progress) ---
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

      // Compute per-task progress in current window (N queries, simple & safe)
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

  // --- EXISTING: Create task ---
  router.post("/createTask", async (req, res) => {
    try {
      const uid = await getUserId(req);
      if (!uid) return res.status(401).json({ error: "Not logged in" });

      const { activityName, timer, counter, deadline, repeat } = req.body || {};
      if (!activityName || (!timer && !counter)) {
        return res.status(400).json({ error: "activityName and (timer or counter) required" });
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

  // --- EXISTING: Delete task ---
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

  // --- NEW: Log progress for a task ---
  router.post("/:id/progress", async (req, res) => {
    try {
      const uid = await getUserId(req);
      if (!uid) return res.status(401).json({ error: "Not logged in" });

      const id = Number(req.params.id);
      const { type, value, at } = req.body || {};
      if (!id || (type !== "minutes" && type !== "count") || !Number(value)) {
        return res.status(400).json({ error: "Bad payload" });
      }

      // Ensure task exists & belongs to user; also that the metric matches
      const { rows: taskRows } = await users.db.query(
        `SELECT id, user_id, timer, counter FROM tasks WHERE id=$1 AND user_id=$2`,
        [id, uid]
      );
      const task = taskRows[0];
      if (!task) return res.status(404).json({ error: "Task not found" });
      if (type === "minutes" && !task.timer) return res.status(400).json({ error: "Task has no timer target" });
      if (type === "count" && !task.counter) return res.status(400).json({ error: "Task has no counter target" });

      await users.db.query(
        `INSERT INTO task_progress (task_id, user_id, type, value, at)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, uid, type, Math.max(1, Number(value)), at ? new Date(at) : new Date()]
      );

      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to log progress" });
    }
  });

  return router;
};
