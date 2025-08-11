// services/emailVerificationService.js
const crypto = require("crypto");
const CONFIG = require("../utils/config");

class EmailVerificationService {
  constructor({ mailer }) {
    this.mailer = mailer;
    this.ttlMs = CONFIG.VERIFY_CODE_TTL_MIN * 60 * 1000;
    this.codes = new Map(); // username -> { email, codeHash, expiresAt, attempts }
  }
  static normalizeEmail(e) { return String(e || "").trim().toLowerCase(); }
  static genCode() { return String(100000 + Math.floor(Math.random() * 900000)); }
  hashCode(code) { return crypto.createHash("sha256").update(code).digest("hex"); }
  start(username, email) {
    const norm = EmailVerificationService.normalizeEmail(email);
    const code = EmailVerificationService.genCode();
    const rec = { email: norm, codeHash: this.hashCode(code), expiresAt: Date.now() + this.ttlMs, attempts: 0 };
    this.codes.set(username, rec);
    return { code, email: norm, expiresAt: rec.expiresAt };
  }
  verify(username, email, code) {
    const rec = this.codes.get(username);
    if (!rec) return { ok: false, reason: "no_request" };
    if (Date.now() > rec.expiresAt) { this.codes.delete(username); return { ok: false, reason: "expired" }; }
    if (EmailVerificationService.normalizeEmail(email) !== rec.email) return { ok: false, reason: "email_mismatch" };
    rec.attempts++; if (rec.attempts > 10) { this.codes.delete(username); return { ok: false, reason: "too_many_attempts" }; }
    if (this.hashCode(code) !== rec.codeHash) return { ok: false, reason: "bad_code" };
    this.codes.delete(username);
    return { ok: true, email: rec.email };
  }
}

module.exports = EmailVerificationService;
