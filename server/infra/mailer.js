// infra/mailer.js
const nodemailer = require("nodemailer");
const CONFIG = require("../utils/config");

class Mailer {
  constructor() {
    // Enable only if all key fields exist
    this.enabled = Boolean(
      CONFIG.SMTP.HOST && CONFIG.SMTP.USER && CONFIG.SMTP.PASS
    );
    if (!this.enabled) {
      console.warn("[mailer] disabled (missing SMTP envs)");
      return;
    }

    const port = Number(CONFIG.SMTP.PORT || 587);
    const secure = port === 465;           // 465 = implicit TLS
    const requireTLS = port === 587;       // 587 = STARTTLS

    this.transporter = nodemailer.createTransport({
      host: CONFIG.SMTP.HOST,              // e.g. smtp.gmail.com / smtp.office365.com / smtp.sendgrid.net
      port,
      secure,                              // true for 465, false for 587
      auth: { user: CONFIG.SMTP.USER, pass: CONFIG.SMTP.PASS },
      requireTLS,                          // enforce STARTTLS on 587
      connectionTimeout: 10000,            // 10s
      greetingTimeout: 10000,
      socketTimeout: 20000,
      // turn these on temporarily if you need more logs:
      // logger: true,
      // debug: true,
    });

    // Try connecting once at startup so misconfig shows up in logs immediately
    this.transporter.verify()
      .then(() => console.log("[mailer] SMTP connection OK"))
      .catch(err => {
        console.error("[mailer] SMTP verify failed:", err?.code || err?.message || err);
        // Leave enabled = true so app can keep running; sendPlain will still catch errors.
      });
  }

  async sendPlain(to, subject, text) {
    if (!this.enabled || !to) return false;
    try {
      await this.transporter.sendMail({
        from: CONFIG.SMTP.FROM || CONFIG.SMTP.USER,  // fallback to user
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
