// routes/stats.js
const express = require("express");

module.exports = function statsRouter(userRepo) {
  const r = express.Router();

  // GET /stats/completion/daily?days=14
  r.get("/completion/daily", async (req, res) => {
    try {
      const userId = Number(req.user?.id || req.query.userId);
      const days = Number(req.query.days || 14);
      if (!userId) return res.status(400).json({ error: "userId required" });
      const { rows } = await userRepo.getDailyCompletion({ userId, days });
      res.json(rows);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /stats/completion/weekly?weeks=8  (optional)
  r.get("/completion/weekly", async (req, res) => {
    try {
      const userId = Number(req.user?.id || req.query.userId);
      const weeks = Number(req.query.weeks || 8);
      if (!userId) return res.status(400).json({ error: "userId required" });
      const { rows } = await userRepo.getWeeklyCompletion({ userId, weeks });
      res.json(rows);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return r;
};
