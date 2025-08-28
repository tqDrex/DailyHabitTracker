// routes/habits.js
const express = require("express");

/**
 * This module exposes:
 *   GET  /habits/day?date=YYYY-MM-DD&userId=123
 *   PUT  /habits/:taskId/complete   { userId, date, completed }
 *
 * It derives "habits" from tasks with repeat/deadline and computes completion
 * from task_progress IN THE WINDOW of the requested date.
 *
 * Requires:
 *   - tasks table: id, user_id, activity_name, timer(int minutes), counter(int), deadline_date, repeat
 *   - task_progress table: (see routes/tasks.js from previous message)
 *
 * Mount with auth:
 *   app.use("/habits", requireAuth, habitsRouter);
 */
module.exports = function buildHabitsRoutes(users) {
  const router = express.Router();

  // -------- window helpers --------
  function atUTCDate(d) {
    // normalize to Date in UTC for "date" (YYYY-MM-DD)
    if (typeof d === "string") {
      // treat as local date; build UTC midnight for that date
      // safer: parse components
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

    // If there's a deadline, we consider from that day's midnight to deadline end
    if (task.deadline_date) {
      const { start } = boundsForDay(dateStr);
      const end = new Date(task.deadline_date);
      // ensure inclusive deadline (UTC end of that day)
      end.setUTCHours(23, 59, 59, 999);
      return { start, end };
    }

    // default: the selected day only
    return boundsForDay(dateStr);
  }

  // -------- GET /habits/day --------
  router.get("/day", async (req, res) => {
    try {
      const { date, userId } = req.query || {};
      if (!date) return res.status(400).json({ error: "Missing date" });
      const uid = Number(userId) || null;
      if (!uid) return res.status(400).json({ error: "Missing userId" });

      // Get all tasks for the user
      const { rows: tasks } = await users.db.query(
        `SELECT id, activity_name, timer, counter, deadline_date, repeat
           FROM tasks
          WHERE user_id = $1
          ORDER BY id DESC`,
        [uid]
      );

      // For each task, compute progress within the relevant window for the selected date
      const out = [];
      for (const t of tasks) {
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

        // mark completed if any active metric for this task is complete
        const completed =
          (timerTarget   ? timerDone   : false) ||
          (counterTarget ? counterDone : false);

        // Only show tasks that are "scheduled" for that date:
        // If repeat is daily/weekly/monthly, it's scheduled.
        // If repeat is null but there's a deadline >= selected date, it's scheduled.
        // Otherwise, skip it.
        const rep = String(t.repeat || "").toLowerCase();
        let scheduled = false;
        if (rep === "daily" || rep === "weekly" || rep === "monthly") {
          scheduled = true;
        } else if (t.deadline_date) {
          const sel = atUTCDate(date);
          const dl  = new Date(t.deadline_date);
          scheduled = sel <= dl; // before or on deadline
        }

        if (!scheduled) continue;

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
        });
      }

      res.json({ date, rows: out });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to load habits for day" });
    }
  });

  // -------- PUT /habits/:taskId/complete --------
  // When CalendarPage toggles the checkbox for a day, we "push" progress to reach the target
  // or "pull" progress (delete within window) to mark it incomplete.
  router.put("/:taskId/complete", async (req, res) => {
    try {
      const taskId = Number(req.params.taskId);
      const { userId, date, completed } = req.body || {};
      const uid = Number(userId) || null;

      if (!taskId || !uid || !date || typeof completed !== "boolean") {
        return res.status(400).json({ error: "Bad payload" });
      }

      // Make sure task exists and belongs to the user
      const { rows: tr } = await users.db.query(
        `SELECT id, user_id, timer, counter, repeat, deadline_date
           FROM tasks
          WHERE id = $1 AND user_id = $2`,
        [taskId, uid]
      );
      const task = tr[0];
      if (!task) return res.status(404).json({ error: "Task not found" });

      const { start, end } = windowBoundsForTaskOnDate(task, date);

      // Current sums in that window
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
        // Add whatever is missing to hit the target(s).
        // If both metrics exist, we complete both.
        if (timerTarget && pm < timerTarget) {
          const addMin = timerTarget - pm;
          await users.db.query(
            `INSERT INTO task_progress (task_id, user_id, type, value, at)
             VALUES ($1, $2, 'minutes', $3, $4)`,
            [taskId, uid, addMin, start.toISOString()] // anchor at window start
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
      } else {
        // Remove all progress entries for that window -> mark incomplete
        await users.db.query(
          `DELETE FROM task_progress
            WHERE task_id = $1
              AND user_id = $2
              AND at >= $3 AND at < $4`,
          [taskId, uid, start.toISOString(), end.toISOString()]
        );
      }

      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to toggle habit completion" });
    }
  });

  return router;
};
