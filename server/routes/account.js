// routes/account.js
const express = require("express");

/**
 * Account routes.
 * Exposes: POST /change-password
 *
 * @param {Object} deps
 * @param {Function} deps.requireAuth - Express middleware that authenticates the request and sets req.user
 * @param {Object} deps.passwordService - Service with changePassword({ userId, currentPassword, newPassword })
 */
module.exports = ({ requireAuth, passwordService }) => {
  if (typeof requireAuth !== "function") {
    throw new Error("accountRoutes expects a requireAuth middleware function");
  }
  if (!passwordService || typeof passwordService.changePassword !== "function") {
    throw new Error("accountRoutes expects a passwordService with changePassword()");
  }

  const router = express.Router();

  // POST /change-password
  router.post("/change-password", requireAuth, async (req, res, next) => {
    try {
      const { currentPassword, newPassword } = req.body || {};

      if (!currentPassword || !newPassword) {
        const e = new Error("Missing currentPassword or newPassword.");
        e.status = 400;
        throw e;
      }

      await passwordService.changePassword({
        userId: req.user.id,
        currentPassword,
        newPassword,
      });

      // Returning mustChangePassword=false helps the client hide the banner immediately
      res.json({ success: true, mustChangePassword: false });
    } catch (e) {
      next(e);
    }
  });

  return router;
};
