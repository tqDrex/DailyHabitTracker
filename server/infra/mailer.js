// infra/mailer.js
const nodemailer = require("nodemailer");
const CONFIG = require("../utils/config");

class Mailer {
  constructor() {
    this.enabled = Boolean(CONFIG.SMTP.HOST && CONFIG.SMTP.USER && CONFIG.SMTP.PASS);
    if (!this.enabled) {
      console.warn("[mailer] disabled (missing SMTP envs)");
      return;
    }

    const port = Number(CONFIG.SMTP.PORT || 587);
    const secure = port === 465;        // 465 = implicit TLS, 587 = STARTTLS

    this.transporter = nodemailer.createTransport({
      host: CONFIG.SMTP.HOST,
      port,
      secure,                           // false for 587, true for 465
      auth: { user: CONFIG.SMTP.USER, pass: CONFIG.SMTP.PASS },
      requireTLS: !secure,              // enforce STARTTLS on 587
      connectionTimeout: 10000,         // 10s
      greetingTimeout: 10000,
      socketTimeout: 20000,
      // logger: true,                   // uncomment to debug
      // debug: true,
    });

    // Fail fast if the connection/auth is wrong
    this.transporter.verify()
      .then(() => console.log("[mailer] SMTP connection OK"))
      .catch(err => console.error("[mailer] SMTP verify failed:", err?.code || err?.message || err));
  }

  async sendPlain(to, subject, text) {
    if (!this.enabled || !to) return false;
    try {
      await this.transporter.sendMail({
        from: CONFIG.SMTP.FROM || CONFIG.SMTP.USER,
        to,
        subject,
        text,
      });
      return true;
    } catch (err) {
      console.error("[mailer] send error:", err?.code || err?.message || err);
      return false;
    }
  }
}

module.exports = Mailer;
