// routes/stats.js
const express = require("express");

/**
 * Stats router
 * - Completion: daily/weekly (counts of completed vs scheduled)
 * - Progress pies: daily/weekly/monthly/yearly with offset (filters to one period)
 *
 * Assumes tables:
 *   tasks(id, user_id, activity_name, timer, counter, repeat, deadline_date, created_at?)
 *   task_progress(task_id, user_id, type, value, at)
 *
 * If tasks.created_at doesn't exist, the queries will treat it as NULL.
 */
module.exports = function statsRouter(userRepoOrDb) {
  // Accept either a repo with .db or a pg Pool itself
  const db = userRepoOrDb.db || userRepoOrDb;
  const r = express.Router();

  // ---------- Helpers ----------
  const clampInt = (v, min, max, def) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return def;
    return Math.max(min, Math.min(max, n|0));
  };

  // -------- Completion: DAILY ----------
  // GET /stats/completion/daily?userId=123&days=14
  r.get("/completion/daily", async (req, res) => {
    try {
      const userId = Number(req.user?.id || req.query.userId);
      const days = clampInt(req.query.days, 1, 90, 14);
      if (!userId) return res.status(400).json({ error: "userId required" });

      const { rows } = await db.query(
        `
        WITH days AS (
          SELECT generate_series(CURRENT_DATE - ($2::int - 1) * INTERVAL '1 day',
                                 CURRENT_DATE,
                                 INTERVAL '1 day')::date AS day
        ),
        agg AS (
          SELECT hl.occurred_on AS day,
                 COUNT(*) AS total,
                 COUNT(*) FILTER (WHERE completed) AS done
          FROM habit_logs hl
          WHERE hl.user_id = $1
            AND hl.occurred_on BETWEEN CURRENT_DATE - ($2::int - 1) * INTERVAL '1 day' AND CURRENT_DATE
          GROUP BY hl.occurred_on
        )
        SELECT
          d.day,
          COALESCE(a.total,0) AS total,
          COALESCE(a.done,0)  AS done,
          CASE WHEN COALESCE(a.total,0)=0 THEN 0
               ELSE ROUND(100.0 * a.done / a.total, 1)
          END AS pct_done
        FROM days d
        LEFT JOIN agg a USING (day)
        ORDER BY d.day
        `,
        [userId, days]
      );
      res.json(rows);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "failed to load daily completion" });
    }
  });

  // -------- Completion: WEEKLY (optional) ----------
  r.get("/completion/weekly", async (req, res) => {
    try {
      const userId = Number(req.user?.id || req.query.userId);
      const weeks = clampInt(req.query.weeks, 1, 52, 8);
      if (!userId) return res.status(400).json({ error: "userId required" });

      const { rows } = await db.query(
        `
        WITH weeks AS (
          SELECT date_trunc('week', (CURRENT_DATE - (i*7))::date)::date AS wk_start
          FROM generate_series(0, $2::int-1) AS g(i)
        ),
        agg AS (
          SELECT date_trunc('week', occurred_on)::date AS wk_start,
                 COUNT(*) AS total,
                 COUNT(*) FILTER (WHERE completed) AS done
          FROM habit_logs
          WHERE user_id = $1
            AND occurred_on >= (SELECT MIN(wk_start) FROM weeks)
          GROUP BY 1
        )
        SELECT
          w.wk_start,
          COALESCE(a.total,0) AS total,
          COALESCE(a.done,0)  AS done,
          CASE WHEN COALESCE(a.total,0)=0 THEN 0
               ELSE ROUND(100.0 * a.done / a.total, 1)
          END AS pct_done
        FROM weeks w
        LEFT JOIN agg a USING (wk_start)
        ORDER BY w.wk_start
        `,
        [userId, weeks]
      );
      res.json(rows);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "failed to load weekly completion" });
    }
  });

  // -------- Progress pies for one period --------
// GET /stats/progress/:window?userId=123&offset=-1
r.get("/progress/:window", async (req, res) => {
  try {
    const userId = Number(req.user?.id || req.query.userId);
    const window = String(req.params.window || "daily").toLowerCase();
    const offset = Number.isFinite(Number(req.query.offset))
      ? Number(req.query.offset) | 0
      : 0;

    if (!userId) return res.status(400).json({ error: "userId required" });
    if (!["daily", "weekly", "monthly", "yearly"].includes(window)) {
      return res.status(400).json({ error: "bad window" });
    }

    // Compute period bounds using ONLY $1 (offset) so Postgres doesn't complain.
    const boundsSql =
      window === "daily"
        ? `
          WITH p AS (
            SELECT (CURRENT_DATE + ($1::int) * INTERVAL '1 day')::date AS d
          )
          SELECT d::timestamptz AS start_ts,
                 (d + INTERVAL '1 day')::timestamptz AS end_ts,
                 d::date AS label_date
          FROM p
        `
        : window === "weekly"
        ? `
          WITH base AS (SELECT date_trunc('week', CURRENT_DATE)::date AS wk0),
               p    AS (SELECT (wk0 + ($1::int) * 7) AS d FROM base)
          SELECT d::timestamptz AS start_ts,
                 (d + INTERVAL '7 day')::timestamptz AS end_ts,
                 d::date AS label_date
          FROM p
        `
        : window === "monthly"
        ? `
          WITH base AS (SELECT date_trunc('month', CURRENT_DATE)::date AS m0),
               p    AS (SELECT (m0 + ($1::int) * INTERVAL '1 month') AS d FROM base)
          SELECT d::timestamptz AS start_ts,
                 (d + INTERVAL '1 month')::timestamptz AS end_ts,
                 d::date AS label_date
          FROM p
        `
        : `
          WITH base AS (SELECT make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int,1,1) AS y0),
               p    AS (SELECT (y0 + ($1::int) * INTERVAL '1 year') AS d FROM base)
          SELECT d::timestamptz AS start_ts,
                 (d + INTERVAL '1 year')::timestamptz AS end_ts,
                 d::date AS label_date
          FROM p
        `;

    const { rows: periodRows } = await db.query(boundsSql, [offset]);
    const { start_ts, end_ts } = periodRows[0];

    // Repeat filter:
    // - daily window: include non-repeating AND daily
    // - other windows: exact match to that repeat
    const repeatClause =
      window === "daily"
        ? `(t.repeat IS NULL OR t.repeat = 'daily')`
        : `t.repeat = $2`;

    // NOTE: no created_at filter (your tasks table doesn't have it). Deadline respected.
    const params =
      window === "daily"
        ? [userId, start_ts, end_ts] // $1, $2, $3
        : [userId, window, start_ts, end_ts]; // $1, $2, $3, $4

    const sql =
      window === "daily"
        ? `
          SELECT
            t.id AS task_id,
            t.activity_name,
            t.timer,
            t.counter,
            t.repeat,
            t.deadline_date,
            COALESCE(SUM(CASE WHEN p.type='minutes' THEN p.value END),0)::int AS progress_minutes,
            COALESCE(SUM(CASE WHEN p.type='count'   THEN p.value END),0)::int AS progress_count,
            LEAST(
              1.0,
              CASE
                WHEN t.timer   IS NOT NULL AND t.timer   > 0
                  THEN COALESCE(SUM(CASE WHEN p.type='minutes' THEN p.value END),0)::float / NULLIF(t.timer,0)
                WHEN t.counter IS NOT NULL AND t.counter > 0
                  THEN COALESCE(SUM(CASE WHEN p.type='count'   THEN p.value END),0)::float / NULLIF(t.counter,0)
                ELSE 0
              END
            ) AS pct
          FROM tasks t
          LEFT JOIN task_progress p
            ON p.task_id = t.id
           AND p.user_id = $1
           AND p.at >= $2::timestamptz
           AND p.at <  $3::timestamptz
          WHERE t.user_id = $1
            AND ${repeatClause}
            AND (t.deadline_date IS NULL OR $2::date <= t.deadline_date)
          GROUP BY t.id, t.activity_name, t.timer, t.counter, t.repeat, t.deadline_date
          ORDER BY t.activity_name
        `
        : `
          SELECT
            t.id AS task_id,
            t.activity_name,
            t.timer,
            t.counter,
            t.repeat,
            t.deadline_date,
            COALESCE(SUM(CASE WHEN p.type='minutes' THEN p.value END),0)::int AS progress_minutes,
            COALESCE(SUM(CASE WHEN p.type='count'   THEN p.value END),0)::int AS progress_count,
            LEAST(
              1.0,
              CASE
                WHEN t.timer   IS NOT NULL AND t.timer   > 0
                  THEN COALESCE(SUM(CASE WHEN p.type='minutes' THEN p.value END),0)::float / NULLIF(t.timer,0)
                WHEN t.counter IS NOT NULL AND t.counter > 0
                  THEN COALESCE(SUM(CASE WHEN p.type='count'   THEN p.value END),0)::float / NULLIF(t.counter,0)
                ELSE 0
              END
            ) AS pct
          FROM tasks t
          LEFT JOIN task_progress p
            ON p.task_id = t.id
           AND p.user_id = $1
           AND p.at >= $3::timestamptz
           AND p.at <  $4::timestamptz
          WHERE t.user_id = $1
            AND ${repeatClause}
            AND (t.deadline_date IS NULL OR $3::date <= t.deadline_date)
          GROUP BY t.id, t.activity_name, t.timer, t.counter, t.repeat, t.deadline_date
          ORDER BY t.activity_name
        `;

    const { rows } = await db.query(sql, params);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "failed to load progress" });
  }
});


  return r;
};
