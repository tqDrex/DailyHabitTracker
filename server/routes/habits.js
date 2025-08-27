// routes/habits.js
const express = require("express");

module.exports = function habitsRouter(userRepo) {
  const r = express.Router();

  // ------------------------------------------------------------------
  // (Legacy) Mark complete for a given date (defaults to today)
  // POST /api/habits/:taskId/complete  { date?, secondsLogged? }
  // Kept for backward compatibility; always sets completed = true
  // ------------------------------------------------------------------
  r.post("/:taskId/complete", async (req, res) => {
    try {
      const userId = Number(req.user?.id || req.body.userId);
      const taskId = Number(req.params.taskId);
      const date = req.body.date ? new Date(req.body.date) : new Date();
      const seconds = req.body.secondsLogged ?? null;

      await userRepo.markComplete({ userId, taskId, date, secondsLogged: seconds });
      res.json({ ok: true });
    } catch (e) {
      console.error("POST /habits/:taskId/complete error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // ------------------------------------------------------------------
  // Idempotent completion setter (preferred)
  // PUT /api/habits/:taskId/complete  { date: 'YYYY-MM-DD', completed: true|false, secondsLogged? }
  // ------------------------------------------------------------------
  r.put("/:taskId/complete", async (req, res) => {
    try {
      const userId = Number(req.user?.id || req.body.userId);
      const taskId = Number(req.params.taskId);
      const { date, completed, secondsLogged } = req.body;

      if (!userId || !taskId || !date || typeof completed !== "boolean") {
        return res.status(400).json({ error: "userId, taskId, date, completed are required" });
      }
      const d = new Date(date); // accepts 'YYYY-MM-DD'
      const row = await userRepo.setCompletion({
        userId,
        taskId,
        date: d,
        completed,
        secondsLogged: secondsLogged ?? null,
      });
      res.json({ row });
    } catch (e) {
      console.error("PUT /habits/:taskId/complete error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // ------------------------------------------------------------------
  // Clear completion for a given date
  // DELETE /api/habits/:taskId/complete?date=YYYY-MM-DD
  // ------------------------------------------------------------------
  r.delete("/:taskId/complete", async (req, res) => {
    try {
      const userId = Number(req.user?.id || req.query.userId);
      const taskId = Number(req.params.taskId);
      const dateStr = req.query.date;
      if (!userId || !taskId || !dateStr) {
        return res.status(400).json({ error: "userId, taskId, date are required" });
      }
      const d = new Date(dateStr);
      // Re-use setCompletion with completed=false to “uncomplete”
      await userRepo.setCompletion({ userId, taskId, date: d, completed: false, secondsLogged: null });
      res.json({ ok: true });
    } catch (e) {
      console.error("DELETE /habits/:taskId/complete error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // ------------------------------------------------------------------
  // List all habits for a day with their completion
  // GET /api/habits/day?date=YYYY-MM-DD
  // Returns: [{ task_id, activity_name, completed, seconds_logged, completed_at }]
  // ------------------------------------------------------------------
  r.get("/day", async (req, res) => {
    try {
      const userId = Number(req.user?.id || req.query.userId);
      const dateStr = req.query.date;
      if (!userId || !dateStr) {
        return res.status(400).json({ error: "userId and date are required" });
      }
      const d = new Date(dateStr);
      const rows = await userRepo.listHabitsForDay({ userId, date: d });
      res.json({ rows });
    } catch (e) {
      console.error("GET /habits/day error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // ------------------------------------------------------------------
  // Current streak for a single habit
  // GET /api/habits/:taskId/streak
  // Returns: { currentStreak: number }
  // ------------------------------------------------------------------
  r.get("/:taskId/streak", async (req, res) => {
    try {
      const userId = Number(req.user?.id || req.query.userId);
      const taskId = Number(req.params.taskId);
      if (!userId || !taskId) {
        return res.status(400).json({ error: "userId and taskId are required" });
      }
      const currentStreak = await userRepo.getCurrentStreak({ userId, taskId });
      res.json({ currentStreak: Number(currentStreak || 0) });
    } catch (e) {
      console.error("GET /habits/:taskId/streak error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // ------------------------------------------------------------------
  // (Optional) generate occurrences ahead (run at login or nightly)
  // POST /api/habits/generate  { horizonDays?: number }
  // ------------------------------------------------------------------
  r.post("/generate", async (req, res) => {
    try {
      const userId = Number(req.user?.id || req.body.userId);
      const horizonDays = Number(req.body.horizonDays || 60);
      await userRepo.generateOccurrences({ userId, horizonDays });
      res.json({ ok: true });
    } catch (e) {
      console.error("POST /habits/generate error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  return r;
};
