// infra/mailer.js
const nodemailer = require("nodemailer");
const CONFIG = require("../utils/config");

class Mailer {
  constructor() {
    this.enabled = Boolean(CONFIG.SMTP.HOST && CONFIG.SMTP.USER && CONFIG.SMTP.PASS);
    if (this.enabled) {
      this.transporter = nodemailer.createTransport({
        host: CONFIG.SMTP.HOST,
        port: CONFIG.SMTP.PORT,
        secure: false,
        auth: { user: CONFIG.SMTP.USER, pass: CONFIG.SMTP.PASS },
      });
    }
  }
  async sendPlain(to, subject, text) {
    if (!this.enabled || !to) return false;
    await this.transporter.sendMail({ from: CONFIG.SMTP.FROM, to, subject, text });
    return true;
  }
}

module.exports = Mailer;
