// utils/requireAuth.js
module.exports = function buildRequireAuth({ auth, users }) {
  return async function requireAuth(req, res, next) {
    try {
      const username = auth.getLoggedInUsername(req); // must read your session/cookie
      if (!username) {
        return res.status(401).json({ error: "Not logged in" });
      }

      const { rows } = await users.getByUsername(username);
      const u = rows && rows[0];
      if (!u) {
        return res.status(401).json({ error: "Not logged in" });
      }

      // Attach only what you need; never include password hashes
      req.user = {
        id: typeof u.id === "string" ? Number(u.id) : u.id,  // ensure a number
        username: u.username,
        email: u.email ?? null,
        must_change_password: !!u.must_change_password,
        // add other non-sensitive fields if you actually use them later
      };

      if (!req.user.id || Number.isNaN(req.user.id)) {
        // Defensive: if your DB uses a different column name like user_id
        const id = typeof u.user_id === "string" ? Number(u.user_id) : u.user_id;
        if (!id || Number.isNaN(id)) {
          return res.status(401).json({ error: "Not logged in" });
        }
        req.user.id = id;
      }

      next();
    } catch (e) {
      next(e);
    }
  };
};
