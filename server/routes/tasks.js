// routes/tasks.js
const express = require("express");
const { getCalendarClient, buildEventFromTask } = require("../utils/calendarSync");

module.exports = function tasksRouter(userRepo) {
  const router = express.Router();

  // Require login on all /tasks routes
  router.use((req, res, next) => {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: "Not logged in" });
    }
    next();
  });

  // GET /tasks -> list tasks for logged-in user
  router.get("/", async (req, res) => {
    try {
      const userId = req.user.id;
      const { rows } = await userRepo.listTasksByUser({ userId });
      res.json(rows);
    } catch (e) {
      console.error("GET /tasks:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /tasks/createTask -> create a task, then create a Google event
  router.post("/createTask", async (req, res) => {
    try {
      const userId = req.user.id;

      const activityName = req.body.activityName?.trim() || null;
      if (!activityName) {
        return res.status(400).json({ error: "activityName required" });
      }

      const timer =
        req.body.timer === null || req.body.timer === "" || req.body.timer === undefined
          ? null
          : Number(req.body.timer);

      const counter =
        req.body.counter === null || req.body.counter === "" || req.body.counter === undefined
          ? null
          : Number(req.body.counter);

      const deadlineDate = req.body.deadline ? new Date(req.body.deadline) : null;
      const repeat = req.body.repeat || null; // 'daily'|'weekly'|'monthly'|'yearly'|null

      // 1) DB insert
      const { rows } = await userRepo.createTask({
        userId,
        activityName,
        timer,
        counter,
        deadlineDate,
        repeat,
      });
      const task = rows?.[0];

      // 2) Fetch full user row (we need tokens + app_calendar_id)
      const u = (await userRepo.getById(userId)).rows?.[0];

      // 3) Create Google event in user's app calendar
      if (u?.app_calendar_id && (u.google_access_token || u.google_refresh_token)) {
        try {
          const calendar = getCalendarClient(u);
          const event = buildEventFromTask(task, "America/New_York");
          const { data } = await calendar.events.insert({
            calendarId: u.app_calendar_id,
            requestBody: event,
          });
          await userRepo.db.query(
            "UPDATE tasks SET google_event_id=$1 WHERE id=$2",
            [data.id, task.id]
          );
          task.google_event_id = data.id;
        } catch (err) {
          console.error("Calendar sync (create) failed:", err?.message || err);
        }
      }

      res.status(201).json(task || { ok: true });
    } catch (e) {
      console.error("POST /tasks/createTask:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // PUT /tasks/:id -> update task + patch Google event
  router.put("/:id", async (req, res) => {
    try {
      const userId = req.user.id;
      const taskId = Number(req.params.id);

      const activityName = req.body.activityName ?? null;
      const timer = req.body.timer ?? null;
      const counter = req.body.counter ?? null;
      const deadlineDate = req.body.deadline ? new Date(req.body.deadline) : null;
      const repeat = req.body.repeat ?? null;

      const { rows } = await userRepo.updateTask({
        taskId,
        userId,
        activityName,
        timer,
        counter,
        deadlineDate,
        repeat,
      });
      const task = rows?.[0];
      if (!task) return res.status(404).json({ error: "Task not found" });

      const u = (await userRepo.getById(userId)).rows?.[0];

      if (u?.app_calendar_id && task.google_event_id && (u.google_access_token || u.google_refresh_token)) {
        try {
          const calendar = getCalendarClient(u);
          const event = buildEventFromTask(task, "America/New_York");
          await calendar.events.patch({
            calendarId: u.app_calendar_id,
            eventId: task.google_event_id,
            requestBody: event,
          });
        } catch (err) {
          console.error("Calendar sync (update) failed:", err?.message || err);
        }
      }

      res.json(task);
    } catch (e) {
      console.error("PUT /tasks/:id:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // DELETE /tasks/:id -> delete task + delete Google event
  router.delete("/:id", async (req, res) => {
    try {
      const userId = req.user.id;
      const taskId = Number(req.params.id);

      const { rows: map } = await userRepo.db.query(
        "SELECT google_event_id FROM tasks WHERE id=$1 AND user_id=$2",
        [taskId, userId]
      );
      const googleEventId = map?.[0]?.google_event_id || null;

      await userRepo.deleteTask({ taskId, userId });

      const u = (await userRepo.getById(userId)).rows?.[0];
      if (u?.app_calendar_id && googleEventId && (u.google_access_token || u.google_refresh_token)) {
        try {
          const calendar = getCalendarClient(u);
          await calendar.events.delete({ calendarId: u.app_calendar_id, eventId: googleEventId });
        } catch (err) {
          console.error("Calendar sync (delete) failed:", err?.message || err);
        }
      }

      res.json({ ok: true });
    } catch (e) {
      console.error("DELETE /tasks/:id:", e);
      res.status(500).json({ error: e.message });
    }
  });

  return router;
};

