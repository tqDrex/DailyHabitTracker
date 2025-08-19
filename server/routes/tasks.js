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

  router.post("/createTask", async (req, res) => {
    try {
      const userId = Number(req.user?.id || req.query.userId);
      const nameOfActivity = req.body.activityName ? Text(req.body.activityName) : null;
      const timer = req.body.timer? Number(req.body.timer) : null;
      const counter = req.body.counter ? Number(req.body.counter) : null;
      const deadline = req.body.deadline ? new Date(req.body.deadline) : new Date();
      const repeat = req.body.repeat ? Text(req.body.repeat) : null;
      console.log(`userID: ${userId}\nnameOfActivity: ${req.body.activityName}\ntimer: ${timer}\ncounter: ${counter}\ndeadline: ${deadline}\nrepeat: ${repeat}`);
      await userRepo.createTask({ userId, nameOfActivity, timer, counter, deadline, repeat });
      res.status(200).json();
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
};
