// routes/local.js
const express = require("express");
const argon2 = require("argon2");
const asyncHandler = require("../utils/asyncHandler");
const { validateLogin } = require("../utils/validators");

module.exports = function buildLocalRoutes({ users, auth }) {
  const router = express.Router();

  router.post(
    "/create",
    asyncHandler(async (req, res) => {
      if (!validateLogin(req.body)) return res.sendStatus(400);
      const { username, password } = req.body;
      const hash = await argon2.hash(password);
      await users.createLocal(username, hash);
      auth.login(res, username);
      res.sendStatus(200);
    })
  );

  router.post(
    "/login",
    asyncHandler(async (req, res) => {
      if (!validateLogin(req.body)) return res.sendStatus(400);
      const { username, password } = req.body;
      const result = await users.getByUsername(username);
      if (!result.rows.length) return res.sendStatus(400);
      const matches = await argon2.verify(result.rows[0].password, password);
      if (!matches) return res.sendStatus(400);
      auth.login(res, username);
      res.sendStatus(200);
    })
  );

  return router;
};
