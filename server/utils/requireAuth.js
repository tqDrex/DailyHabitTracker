// utils/requireAuth.js
module.exports = function buildRequireAuth({ auth, users }) {
  return async function requireAuth(req, res, next) {
    try {
      const username = auth.getLoggedInUsername(req);
      if (!username) return res.sendStatus(403);

      const row = (await users.getByUsername(username)).rows?.[0];
      if (!row) return res.sendStatus(403);

      req.user = row; // must include .id and .password fields
      next();
    } catch (e) {
      next(e);
    }
  };
};
