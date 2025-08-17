// routes/habits.js
const express = require("express");
module.exports = function habitsRouter(userRepo) {
  const r = express.Router();

  // Mark complete for a given date (defaults to today)
  r.post("/:taskId/complete", async (req, res) => {
    try {
      const userId = Number(req.user?.id || req.body.userId);
      const taskId = Number(req.params.taskId);
      const date = req.body.date ? new Date(req.body.date) : new Date();
      const seconds = req.body.secondsLogged ?? null;

      await userRepo.markComplete({ userId, taskId, date, secondsLogged: seconds });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // (Optional) generate occurrences ahead (run at login or nightly)
  r.post("/generate", async (req, res) => {
    try {
      const userId = Number(req.user?.id || req.body.userId);
      const horizonDays = Number(req.body.horizonDays || 60);
      await userRepo.generateOccurrences({ userId, horizonDays });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return r;
};
