// routes/streaks.js
const express = require("express");

module.exports = function streaksRouter(users) {
  const r = express.Router();

  // Current per-task streaks (hide non-positive)
  r.get("/current", async (req, res) => {
    try {
      const userId = Number(req.user?.id || req.query.userId);
      if (!userId) return res.status(400).json({ error: "userId required" });

      const { rows } = await users.db.query(
        `SELECT
           t.id                         AS task_id,
           t.activity_name              AS activity_name,
           COALESCE(s.current_streak,0) AS current_streak_days
         FROM tasks t
         LEFT JOIN task_streaks s ON s.task_id = t.id
        WHERE t.user_id = $1
          AND COALESCE(s.current_streak,0) > 0
        ORDER BY current_streak_days DESC, t.id DESC`,
        [userId]
      );

      res.json(rows);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message || "Failed to load current streaks" });
    }
  });

  // Best per-task streaks (hide non-positive)
  r.get("/best", async (req, res) => {
    try {
      const userId = Number(req.user?.id || req.query.userId);
      if (!userId) return res.status(400).json({ error: "userId required" });

      const { rows } = await users.db.query(
        `SELECT
           t.id                       AS task_id,
           t.activity_name            AS activity_name,
           COALESCE(s.best_streak,0)  AS best_streak_days
         FROM tasks t
         LEFT JOIN task_streaks s ON s.task_id = t.id
        WHERE t.user_id = $1
          AND COALESCE(s.best_streak,0) > 0
        ORDER BY best_streak_days DESC, t.id DESC`,
        [userId]
      );

      res.json(rows);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message || "Failed to load best streaks" });
    }
  });

  // Optional: overall streak across any tasks using the same table
  r.get("/overall", async (req, res) => {
    try {
      const userId = Number(req.user?.id || req.query.userId);
      if (!userId) return res.status(400).json({ error: "userId required" });

      const { rows } = await users.db.query(
        `SELECT
           COALESCE(MAX(s.current_streak), 0) AS current_streak_days,
           COALESCE(MAX(s.best_streak),    0) AS best_streak_days
         FROM tasks t
         LEFT JOIN task_streaks s ON s.task_id = t.id
        WHERE t.user_id = $1`,
        [userId]
      );
      res.json(rows[0] || { current_streak_days: 0, best_streak_days: 0 });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message || "Failed to load overall streak" });
    }
  });

  return r;
};
