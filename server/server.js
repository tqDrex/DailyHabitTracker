// server.js
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const passport = require("passport");
const session = require("express-session");

const env = require("./env.json"); // pg config

// Local modules
const CONFIG = require("./utils/config");
const buildRequireAuth = require("./utils/requireAuth");
const Database = require("./infra/database");
const Mailer = require("./infra/mailer");
const UserRepository = require("./domain/userRepo");
const AuthService = require("./services/authService");
const EmailVerificationService = require("./services/emailVerificationService");
const PasswordService = require("./services/passwordService");

// Route factories (DI)
const authRoutes = require("./routes/auth");
const localRoutes = require("./routes/local");
const buildAccountRoutes = require("./routes/account");

(async function main() {
  // ----- Infra -----
  const db = new Database(env);
  await db.connect();

  const mailer = new Mailer();

  // ----- Domain / Services -----
  const users = new UserRepository(db);
  await users.ensureSchema();

  const auth = new AuthService();
  const emailVerify = new EmailVerificationService({ mailer });

  // ----- App -----
  const app = express();

  app.use(
    cors({
      origin: CONFIG.FRONTEND_URL,
      credentials: true,
    })
  );
  app.use(express.json());
  app.use(cookieParser());

  // Session (Passport uses this; your app auth uses a custom cookie)
  app.use(
    session({
      secret: CONFIG.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
    })
  );

  app.use(passport.initialize());
  app.use(passport.session());

  // Google OAuth strategy (shares DI instances)
  require("./passport")({ CONFIG, users, db, mailer, auth });

  // ----- Auth gate for protected routes -----
  const requireAuth = buildRequireAuth({ auth, users });

  // Routers that depend on userRepo (create AFTER users)
  const streaksRouter = require("./routes/streaks")(users);
  const habitsRouter  = require("./routes/habits")(users);
  const tasksRouter   = require("./routes/tasks")(users); // remove if you don't have this file
  const statsRouter   = require("./routes/stats")(users); // <-- create here (users is ready)

  // Mount protected domain routes (mount AFTER requireAuth exists)
  app.use("/streaks", requireAuth, streaksRouter);
  app.use("/habits",  requireAuth, habitsRouter);
  app.use("/tasks",   requireAuth, tasksRouter);
  app.use("/stats",   requireAuth, statsRouter); // <-- fixes /stats/completion/daily 404

  // Auth / account routes
  app.use(authRoutes({ CONFIG, users, auth, emailVerify, mailer }));
  if (CONFIG.AUTH_ALLOW_LOCAL) app.use(localRoutes({ users, auth }));

  // Public ping
  app.get("/public", (_req, res) => res.send("A public message\n"));

  // Adapt repo to PasswordService and mount /change-password
  const passwordService = new PasswordService({
    users: {
      getById: async (id) => {
        const { rows } = await users.getById(id);
        return rows[0] || null;
      },
      updatePasswordAndClearFlag: async (userId, newHash) => {
        await users.updatePasswordAndClearFlag(userId, newHash);
      },
    },
  });
  app.use(buildAccountRoutes({ requireAuth, passwordService }));

  // ----- Errors -----
  app.use((err, _req, res, _next) => {
    console.error(err);
    if (res.headersSent) return;
    res.status(err.status || 500).json({ error: err.message || "Internal Server Error" });
  });

  // ----- Listen -----
  app.listen(CONFIG.PORT, CONFIG.HOSTNAME, () => {
    console.log(`http://${CONFIG.HOSTNAME}:${CONFIG.PORT}`);
  });
})().catch((e) => {
  console.error("Failed to start server:", e);
  process.exit(1);
});
