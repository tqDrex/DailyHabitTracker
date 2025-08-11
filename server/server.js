// server.js
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const passport = require("passport");

const env = require("./env.json"); // pg config

// local modules
const CONFIG = require("./utils/config");
const Database = require("./infra/database");
const Mailer = require("./infra/mailer");
const UserRepository = require("./domain/userRepo");
const AuthService = require("./services/authService");
const EmailVerificationService = require("./services/emailVerificationService");

// routes
const authRoutes = require("./routes/auth");
const localRoutes = require("./routes/local");

// wire up
(async function main() {
  const db = new Database(env);
  await db.connect();

  const mailer = new Mailer();
  const users = new UserRepository(db);
  const auth = new AuthService();
  const emailVerify = new EmailVerificationService({ mailer });

  const app = express();
  app.use(cors({ origin: CONFIG.FRONTEND_URL, credentials: true }));
  app.use(express.json());
  app.use(cookieParser());
  app.use(passport.initialize());

  // Google strategy (uses the same DI instances)
  require("./passport")({ CONFIG, users, db, mailer, auth });

  // Routes
  app.use(authRoutes({ CONFIG, users, auth, emailVerify, mailer }));
  if (CONFIG.AUTH_ALLOW_LOCAL) app.use(localRoutes({ users, auth })); // optional

  // Public ping
  app.get("/public", (_req, res) => res.send("A public message\n"));

  // Errors
  app.use((err, _req, res, _next) => {
    console.error(err);
    if (res.headersSent) return;
    res.status(500).json({ error: "Internal Server Error" });
  });

  app.listen(CONFIG.PORT, CONFIG.HOSTNAME, () => {
    console.log(`http://${CONFIG.HOSTNAME}:${CONFIG.PORT}`);
  });
})().catch((e) => {
  console.error("Failed to start server:", e);
  process.exit(1);
});
