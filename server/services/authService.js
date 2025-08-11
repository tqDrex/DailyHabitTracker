// services/authService.js
const crypto = require("crypto");
const CONFIG = require("../utils/config");

class AuthService {
  constructor() {
    this.tokenStorage = Object.create(null);
    this.cookieOptions = CONFIG.COOKIE;
  }
  makeToken() { return crypto.randomBytes(32).toString("hex"); }
  getLoggedInUsername(req) {
    const { token } = req.cookies || {};
    return token ? this.tokenStorage[token] || null : null;
  }
  login(res, username) {
    const token = this.makeToken();
    this.tokenStorage[token] = username;
    res.cookie("token", token, this.cookieOptions);
  }
  logout(req, res) {
    const { token } = req.cookies || {};
    if (!token || !Object.prototype.hasOwnProperty.call(this.tokenStorage, token)) return false;
    delete this.tokenStorage[token];
    res.clearCookie("token", this.cookieOptions);
    return true;
  }
  getAuthorizeMiddleware() {
    return (req, res, next) => {
      const { token } = req.cookies || {};
      if (!token || !Object.prototype.hasOwnProperty.call(this.tokenStorage, token)) {
        return res.sendStatus(403);
      }
      next();
    };
  }
}

module.exports = AuthService;
