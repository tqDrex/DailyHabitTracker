// routes/tasks.js
const express = require('express');
module.exports = function tasksRouter(userRepo) {
    const router = express.Router();

    // Generate tasks for a given user on their todo page
    router.get("/tasks", async (req, res) => {
        try{
            const userId = Number(req.user?.id || req.query.userId);
            const { rows } = await listTasksByUser({ userId });
            res.json({ rows })
        }
    });
}