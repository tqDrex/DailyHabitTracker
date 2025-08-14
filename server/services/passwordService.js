// services/passwordService.js
const argon2 = require("argon2");

/**
 * PasswordService
 * - Verifies the user's current password (works whether they were forced to change or not)
 * - Enforces basic new-password rules
 * - Updates the password and clears must_change_password flag
 *
 * Expects your users repo to implement:
 *   - getById(id) -> user | null  (user has fields: id, password, must_change_password, ...)
 *   - updatePasswordAndClearFlag(userId, newHash) -> void
 */
class PasswordService {
  /**
   * @param {{ users: { getById: Function, updatePasswordAndClearFlag: Function } }} deps
   */
  constructor({ users }) {
    if (!users) throw new Error("PasswordService needs a users repo");
    this.users = users;
  }

  /**
   * @param {{ userId: string|number, currentPassword: string, newPassword: string }} input
   */
  async changePassword({ userId, currentPassword, newPassword }) {
    // 1) Load user
    const user = await this.users.getById(userId);
    if (!user) {
      const e = new Error("User not found");
      e.status = 404;
      throw e;
    }

    // 2) Verify current password against stored hash
    const storedHash = user.password;
    if (!storedHash) {
      const e = new Error("No password set for this account.");
      e.status = 400;
      throw e;
    }

    // argon2.verify(hash, plain)
    const ok = await argon2.verify(storedHash, currentPassword).catch(() => false);
    if (!ok) {
      const e = new Error("Current password is incorrect.");
      e.status = 400;
      throw e;
    }

    // 3) Validate new password policy (you can expand these rules later)
    if (typeof newPassword !== "string" || newPassword.length < 8) {
      const e = new Error("New password must be at least 8 characters.");
      e.status = 422;
      throw e;
    }
    if (newPassword === currentPassword) {
      const e = new Error("New password must be different from the current password.");
      e.status = 422;
      throw e;
    }

    // 4) Hash and persist
    const newHash = await argon2.hash(newPassword);
    await this.users.updatePasswordAndClearFlag(user.id, newHash);
    // DB layer should:
    //   UPDATE users SET password=$1, must_change_password=false, updated_at=NOW() WHERE id=$2
  }
}

module.exports = PasswordService;
