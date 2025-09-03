// server.js
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const passport = require("passport");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session); // ✅ use a real session store

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
  const db = new Database();
  await db.connect();

  const mailer = new Mailer();

  // ----- Domain / Services -----
  const users = new UserRepository(db);
  await users.ensureSchema();

  const auth = new AuthService();
  const emailVerify = new EmailVerificationService({ mailer });

  // ----- App -----
  const app = express();

  // Railway sits behind a proxy; this is REQUIRED for secure cookies to work
  app.set("trust proxy", 1); // ✅

  // CORS for your SPA origin
  app.use(
    cors({
      origin: CONFIG.FRONTEND_URL, // e.g. https://your-frontend.up.railway.app
      credentials: true,
      optionsSuccessStatus: 204,
    })
  );

  app.use(express.json());
  app.use(cookieParser());

  // ---------- Sessions (Passport needs this) ----------
  // Use Postgres-backed sessions instead of MemoryStore (prod safe)
  app.use(
    session({
      store: new pgSession({
        conString: process.env.DATABASE_URL, // same Postgres your app uses
        createTableIfMissing: true,
        tableName: "session", // optional
      }),
      name: "sid", // optional cookie name
      secret: CONFIG.SESSION_SECRET, // ✅ fixes "req.secret" deprecation
      resave: false,
      saveUninitialized: false,
      cookie: {
        ...CONFIG.COOKIE, // e.g. { httpOnly:true, secure:true, sameSite:"none"|"lax", maxAge:... }
      },
    })
  );

  app.use(passport.initialize());
  app.use(passport.session());

  // Google OAuth strategy
  require("./passport")({ CONFIG, users, db, mailer, auth });

  // ----- Auth gate for protected routes -----
  const requireAuth = buildRequireAuth({ auth, users });

  // Domain routers (DI)
  const streaksRouter = require("./routes/streaks")(users);
  const habitsRouter = require("./routes/habits")(users);
  const tasksRouter = require("./routes/tasks")(users); // if implemented
  const statsRouter = require("./routes/stats")(users);

  // Mount protected routes
  app.use("/streaks", requireAuth, streaksRouter);
  app.use("/habits", requireAuth, habitsRouter);
  app.use("/tasks", requireAuth, tasksRouter);
  app.use("/stats", requireAuth, statsRouter);

  // Auth / account routes
  app.use(authRoutes({ CONFIG, users, auth, emailVerify, mailer }));
  if (CONFIG.AUTH_ALLOW_LOCAL) app.use(localRoutes({ users, auth }));

  // Health/public endpoints
  app.get("/healthz", (_req, res) => res.send("ok")); // ✅ handy for Railway checks
  app.get("/public", (_req, res) => res.send("A public message\n"));

  // Password change route
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

  // ----- Error handler -----
  app.use((err, _req, res, _next) => {
    console.error(err);
    if (res.headersSent) return;
    res
      .status(err.status || 500)
      .json({ error: err.message || "Internal Server Error" });
  });

  // ----- Listen -----
  // ✅ On Railway, DO NOT bind to a hostname; let Node use 0.0.0.0
  app.listen(CONFIG.PORT, () => {
    console.log(`listening on :${CONFIG.PORT}`);
  });
})().catch((e) => {
  console.error("Failed to start server:", e);
  process.exit(1);
});
