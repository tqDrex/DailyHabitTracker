// routes/streaks.js
const express = require("express");
module.exports = function streaksRouter(userRepo) {
  const r = express.Router();

  // Per-habit current streaks
  r.get("/current", async (req, res) => {
    try {
      const userId = Number(req.user?.id || req.query.userId); // adapt to your auth
      const { rows } = await userRepo.getCurrentStreaks({ userId });
      res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Per-habit best streaks
  r.get("/best", async (req, res) => {
    try {
      const userId = Number(req.user?.id || req.query.userId);
      const { rows } = await userRepo.getBestStreaks({ userId });
      res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // (Optional) Overall daily streak across *any* completion (see §4 for variants)
  r.get("/overall", async (req, res) => {
    try {
      const userId = Number(req.user?.id || req.query.userId);
      const { rows } = await userRepo.getOverallDailyStreak({ userId });
      res.json(rows[0] || { current_streak_days: 0, best_streak_days: 0 });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return r;
};
