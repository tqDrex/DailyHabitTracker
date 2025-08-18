// routes/tasks.js
const express = require("express");

module.exports = function tasksRouter(userRepo) {
  const router = express.Router();

  // GET /tasks -> list all tasks for a user
  router.get("/", async (req, res) => {
    try {
      const userId = Number(req.user?.id || req.query.userId);
      const { rows } = await userRepo.listTasksByUser({ userId });
      res.json(rows);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
};
