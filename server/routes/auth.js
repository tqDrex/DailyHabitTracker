// routes/auth.js
const express = require("express");
const passport = require("passport");
const asyncHandler = require("../utils/asyncHandler");
const { isValidEmail } = require("../utils/validators");

module.exports = function buildAuthRoutes({ CONFIG, users, auth, emailVerify, mailer }) {
  const router = express.Router();
  const authorize = auth.getAuthorizeMiddleware();

  // Google OAuth
  router.get(
    "/auth/google",
    passport.authenticate("google", {
      scope: ["openid", "email", "profile"],
      prompt: "select_account",
      session: false,
      state: true,
    })
  );

  router.get(
    "/auth/google/link",
    authorize,
    passport.authenticate("google", {
      scope: ["openid", "email", "profile"],
      prompt: "select_account",
      session: false,
      state: true,
    })
  );

  router.get(
    "/auth/google/callback",
    passport.authenticate("google", { failureRedirect: "/auth/failure", session: false }),
    asyncHandler(async (req, res) => {
      let username = auth.getLoggedInUsername(req);
      if (!username && req.user?.username) {
        auth.login(res, req.user.username);
        username = req.user.username;
      }
      if (!username) return res.redirect("/auth/failure");

      const row = (await users.getByUsername(username)).rows?.[0];
      const mustChange = !!row?.must_change_password;
      const target = mustChange ? "/change-password" : "/dashboard";
      res.redirect(`${CONFIG.FRONTEND_URL}${target}`);
    })
  );

  router.get("/auth/failure", (_req, res) => res.status(401).send("Login failed"));

  // Session / profile
  router.get("/private", authorize, (_req, res) => res.send("A private message\n"));

  router.get(
    "/api/me",
    asyncHandler(async (req, res) => {
      const username = auth.getLoggedInUsername(req);
      if (!username) return res.status(401).json({ error: "Not logged in" });
      const profile = await users.getPublicProfile(username);
      if (!profile) return res.status(401).json({ error: "Not logged in" });
      res.json({
        username: profile.username,
        name: profile.name || profile.username,
        email: profile.email || null,
        avatarUrl: profile.avatar_url || null,
        mustChangePassword: !!profile.must_change_password,
      });
    })
  );

  router.post("/logout", (req, res) => {
    const ok = auth.logout(req, res);
    res.sendStatus(ok ? 200 : 400);
  });

  // Email link + verification
  router.post(
    "/api/link-email/start",
    authorize,
    asyncHandler(async (req, res) => {
      const username = auth.getLoggedInUsername(req);
      const { email } = req.body || {};
      const norm = emailVerify.constructor.normalizeEmail(email);
      if (!isValidEmail(norm)) return res.status(400).json({ error: "Invalid email" });

      const existing = await users.getByEmail(norm);
      if (existing.rowCount > 0) {
        return res.status(409).json({ error: "Email already linked to another account" });
      }

      const { code, expiresAt } = emailVerify.start(username, norm);

      let mailed = false;
      try {
        mailed = await mailer.sendPlain(
          norm,
          "Your verification code",
          `Your code is ${code}.\nIt expires in ${Math.round(emailVerify.ttlMs / 60000)} minutes.`
        );
      } catch (e) {
        console.error("VERIFY CODE email error:", e);
      }
      if (!mailed) console.log(`[DEV ONLY] Verification code for ${username} (${norm}): ${code}`);

      res.json({ ok: true, expiresAt });
    })
  );

  router.post(
    "/api/link-email/verify",
    authorize,
    asyncHandler(async (req, res) => {
      const username = auth.getLoggedInUsername(req);
      const { email, code } = req.body || {};
      if (!email || !code) return res.status(400).json({ error: "Missing email or code" });

      const existing = await users.getByEmail(String(email).toLowerCase());
      if (existing.rowCount > 0) {
        return res.status(409).json({ error: "Email already linked to another account" });
      }

      const result = emailVerify.verify(username, email, code);
      if (!result.ok) {
        const map = {
          no_request: 400, expired: 400, email_mismatch: 400, bad_code: 400, too_many_attempts: 429,
        };
        return res.status(map[result.reason] || 400).json({ ok: false, error: result.reason });
      }

      await users.setEmail(username, result.email);
      res.json({ ok: true });
    })
  );

  // Legacy direct link
  router.post(
    "/api/link-email",
    authorize,
    asyncHandler(async (req, res) => {
      const username = auth.getLoggedInUsername(req);
      const { email } = req.body || {};
      if (!isValidEmail(email)) return res.status(400).json({ error: "Invalid email" });
      const existing = await users.getByEmail(email);
      if (existing.rowCount > 0) return res.status(409).json({ error: "Email already linked to another account" });
      await users.setEmail(username, email);
      res.sendStatus(200);
    })
  );

  return router;
};
