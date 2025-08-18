// domain/userRepo.js
const { Client } = require("pg");

/**
 * UserRepository — data access & schema management for users, tasks, and habit logs.
 *
 * Usage:
 *   // 1) Ensure the local DB 'user_database' exists (optional, once at startup)
 *   await UserRepository.ensureLocalDatabase({
 *     user: process.env.PGUSER || "postgres",
 *     password: process.env.PGPASSWORD || "",
 *     host: process.env.PGHOST || "localhost",
 *     port: Number(process.env.PGPORT || 5432),
 *     dbName: "user_database",              // <-- will be created if missing
 *   });
 *
 *   // 2) Create your Pool for 'user_database' and pass it into the repo:
 *   const { Pool } = require("pg");
 *   const pool = new Pool({ database: "user_database", user, password, host, port });
 *   const userRepo = new UserRepository(pool);
 *   await userRepo.ensureSchema();          // idempotent schema creation/repair
 */
class UserRepository {
  constructor(db) {
<<<<<<< HEAD
    this.db = db; // a pg.Pool or any object exposing .query(sql, params)
  }

  /**
   * Ensure the given database exists in the local Postgres.
   * - Connects to the default 'postgres' database
   * - Checks pg_database
   * - Creates the requested DB if missing
   *
   * @param {{user:string, password?:string, host?:string, port?:number, dbName:string}} cfg
   */
  static async ensureLocalDatabase(cfg) {
    const {
      user,
      password = undefined,
      host = "localhost",
      port = 5432,
      dbName = "user_database", // default per your ask
    } = cfg;

    const admin = new Client({
      user,
      password,
      host,
      port,
      database: "postgres", // connect to default db to manage others
    });

    await admin.connect();
    try {
      const { rows } = await admin.query(
        "SELECT 1 FROM pg_database WHERE datname = $1",
        [dbName]
      );
      if (rows.length === 0) {
        // CREATE DATABASE doesn't support IF NOT EXISTS; we gate it with the SELECT above.
        await admin.query(`CREATE DATABASE "${dbName}"`);
        // Optionally set the owner explicitly:
        // await admin.query(`ALTER DATABASE "${dbName}" OWNER TO "${user}"`);
        // Optionally set encoding/locale:
        // await admin.query(`ALTER DATABASE "${dbName}" SET client_encoding TO 'UTF8'`);
        // You can add any DB-level settings you prefer here.
      }
    } finally {
      await admin.end();
    }
=======
    this.db = db;
>>>>>>> origin/main
  }

  /**
   * Ensure DB schema exists and is in a good state.
<<<<<<< HEAD
   * - Advisory lock to avoid races
   * - Transaction for atomicity
   * - Idempotent CREATE/ALTER/INDEX/CONSTRAINT/trigger definitions
   */
  async ensureSchema() {
    const lockKey = 873245901; // any stable 32-bit int
    await this.db.query("SELECT pg_advisory_lock($1)", [lockKey]);
=======
   * - Wraps in a transaction
   * - Uses IF NOT EXISTS guards
   * - Adds/repairs constraints/indexes idempotently
   */
  async ensureSchema() {
    // Optional advisory lock to avoid races if multiple instances start together
    await this.db.query("SELECT pg_advisory_lock(873245901)");

>>>>>>> origin/main
    await this.db.query("BEGIN");
    try {
      // ---------------------------
      // 1) USERS TABLE
      // ---------------------------
      await this.db.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          username TEXT UNIQUE NOT NULL,
          password TEXT,
          email TEXT UNIQUE,
          google_id TEXT UNIQUE,
          name TEXT,
          avatar_url TEXT,
          must_change_password BOOLEAN NOT NULL DEFAULT false,
          google_access_token TEXT,
          google_refresh_token TEXT,
          google_token_expiry TIMESTAMPTZ,
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          app_calendar_id  TEXT
        )
      `);

      // Ensure columns exist (idempotent)
      await this.db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password TEXT`);
      await this.db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT`);
      await this.db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT`);
      await this.db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT`);
      await this.db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT`);
      await this.db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN`);
      await this.db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_access_token TEXT`);
      await this.db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_refresh_token TEXT`);
      await this.db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_token_expiry TIMESTAMPTZ`);
      await this.db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`);
      await this.db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS app_calendar_id TEXT`);

      // Backfill + enforce NOT NULL / defaults where safe
      await this.db.query(`UPDATE users SET must_change_password = COALESCE(must_change_password, false)`);
      await this.db.query(`ALTER TABLE users ALTER COLUMN must_change_password SET DEFAULT false`);
      await this.db.query(`ALTER TABLE users ALTER COLUMN must_change_password SET NOT NULL`);

<<<<<<< HEAD
      // Only enforce NOT NULL on password if there are no NULLs (keeps Google-only accounts valid)
=======
      // If you *know* every user has a password, you can enforce NOT NULL:
      // Guard to only enforce if no NULLs exist.
>>>>>>> origin/main
      await this.db.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM users WHERE password IS NULL) THEN
            ALTER TABLE users ALTER COLUMN password SET NOT NULL;
          END IF;
        END$$;
      `);

      // Unique constraints (idempotent)
      await this.db.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_username_key') THEN
            ALTER TABLE users ADD CONSTRAINT users_username_key UNIQUE (username);
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_email_key') THEN
            ALTER TABLE users ADD CONSTRAINT users_email_key UNIQUE (email);
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_google_id_key') THEN
            ALTER TABLE users ADD CONSTRAINT users_google_id_key UNIQUE (google_id);
          END IF;
        END$$;
      `);

      // updated_at trigger (auto-refresh on UPDATE)
      await this.db.query(`
        CREATE OR REPLACE FUNCTION set_updated_at()
        RETURNS trigger AS $$
        BEGIN
          NEW.updated_at := NOW();
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
      `);
      await this.db.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_set_updated_at_users') THEN
            CREATE TRIGGER tr_set_updated_at_users
            BEFORE UPDATE ON users
            FOR EACH ROW
            EXECUTE FUNCTION set_updated_at();
          END IF;
        END$$;
      `);

<<<<<<< HEAD
      // Helpful indexes
=======
      // Helpful indexes (idempotent)
>>>>>>> origin/main
      await this.db.query(`CREATE INDEX IF NOT EXISTS users_username_idx ON users (username)`);
      await this.db.query(`CREATE INDEX IF NOT EXISTS users_email_idx ON users (email)`);

      // ---------------------------
      // 2) EMAIL_VERIFICATIONS TABLE
      // ---------------------------
      await this.db.query(`
        CREATE TABLE IF NOT EXISTS email_verifications (
          id SERIAL PRIMARY KEY,
          username TEXT NOT NULL,
          email TEXT NOT NULL,
          code_hash TEXT NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          consumed BOOLEAN NOT NULL DEFAULT false
        )
      `);

      // Ensure FK to users(username)
      await this.db.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_verifications_username_fkey') THEN
            ALTER TABLE email_verifications
              ADD CONSTRAINT email_verifications_username_fkey
              FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE;
          END IF;
        END$$;
      `);

<<<<<<< HEAD
      // One active code per user (partial unique index)
=======
      // Partial unique index (only one active code per user)
>>>>>>> origin/main
      await this.db.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_indexes
            WHERE schemaname = 'public' AND indexname = 'email_verifications_one_active'
          ) THEN
            CREATE UNIQUE INDEX email_verifications_one_active
              ON email_verifications (username)
              WHERE consumed = false;
          END IF;
        END$$;
      `);

      // Helper indexes
      await this.db.query(`CREATE INDEX IF NOT EXISTS ev_username_consumed_idx ON email_verifications (username, consumed)`);
      await this.db.query(`CREATE INDEX IF NOT EXISTS ev_expires_at_idx ON email_verifications (expires_at)`);

      // ---------------------------
      // 3) TASKS TABLE (per-user)
      // ---------------------------
      await this.db.query(`
        CREATE TABLE IF NOT EXISTS tasks (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          activity_name TEXT NOT NULL,
          timer INTEGER,     -- >= 0 if provided
          counter INTEGER,   -- >= 0 if provided
          deadline_date DATE,
          repeat TEXT,       -- daily | weekly | monthly | yearly

          CONSTRAINT tasks_timer_counter_check CHECK (
            timer IS NOT NULL OR counter IS NOT NULL
          ),
          CONSTRAINT tasks_timer_nonneg CHECK (timer IS NULL OR timer >= 0),
          CONSTRAINT tasks_counter_nonneg CHECK (counter IS NULL OR counter >= 0),
          CONSTRAINT tasks_repeat_check CHECK (
            repeat IS NULL OR repeat IN ('daily','weekly','monthly','yearly')
          )
        )
      `);

      await this.db.query(`CREATE INDEX IF NOT EXISTS tasks_user_id_idx ON tasks (user_id)`);
      await this.db.query(`CREATE INDEX IF NOT EXISTS tasks_deadline_date_idx ON tasks (deadline_date)`);

<<<<<<< HEAD
      // ---------------------------
      // 4) HABIT_LOGS TABLE (per-task per-day ledger)
      // ---------------------------
      await this.db.query(`
        CREATE TABLE IF NOT EXISTS habit_logs (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          occurred_on DATE NOT NULL,
          completed BOOLEAN NOT NULL DEFAULT FALSE,
          completed_at TIMESTAMPTZ,
          seconds_logged INTEGER CHECK (seconds_logged IS NULL OR seconds_logged >= 0),
          UNIQUE (task_id, occurred_on)
        )
      `);

      await this.db.query(`CREATE INDEX IF NOT EXISTS habit_logs_user_day_idx ON habit_logs (user_id, occurred_on)`);
      await this.db.query(`CREATE INDEX IF NOT EXISTS habit_logs_user_task_idx ON habit_logs (user_id, task_id)`);
      await this.db.query(`
        CREATE INDEX IF NOT EXISTS habit_logs_user_today_open_idx
        ON habit_logs (user_id, occurred_on)
        WHERE completed = false
      `);

      // Commit schema
      await this.db.query("COMMIT");
    } catch (e) {
      await this.db.query("ROLLBACK");
      await this.db.query("SELECT pg_advisory_unlock($1)", [lockKey]);
      throw e;
    }
    await this.db.query("SELECT pg_advisory_unlock($1)", [lockKey]);
=======
      // Commit all schema work
      await this.db.query("COMMIT");
    } catch (e) {
      await this.db.query("ROLLBACK");
      await this.db.query("SELECT pg_advisory_unlock(873245901)");
      throw e;
    }

    await this.db.query("SELECT pg_advisory_unlock(873245901)");
>>>>>>> origin/main
  }

  // ---------------------------
  // USERS: Queries & Commands
  // ---------------------------

  getById(id) {
    return this.db.query("SELECT * FROM users WHERE id=$1", [id]);
  }

  getByUsername(username) {
    return this.db.query("SELECT * FROM users WHERE username=$1", [username]);
  }

  getByEmail(email) {
    return this.db.query("SELECT * FROM users WHERE email=$1", [email]);
  }

  getByGoogleId(googleId) {
    return this.db.query("SELECT * FROM users WHERE google_id=$1", [googleId]);
  }

  async usernameExists(username) {
    const { rows } = await this.db.query("SELECT 1 FROM users WHERE username=$1", [username]);
    return rows.length > 0;
<<<<<<< HEAD
  }

=======
    }
  
>>>>>>> origin/main
  createLocal(username, hash) {
    return this.db.query(
      "INSERT INTO users (username, password) VALUES ($1, $2)",
      [username, hash]
    );
  }

  async createFromGoogle({ username, hash, email, googleId, name, avatarUrl, mustChange = true }) {
    await this.db.query(
      `INSERT INTO users (username, password, email, google_id, name, avatar_url, must_change_password)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [username, hash, email, googleId, name, avatarUrl, mustChange]
    );
    const created = await this.db.query("SELECT * FROM users WHERE username=$1", [username]);
    return created.rows[0];
  }

  linkGoogleToUser({ googleId, name, avatarUrl, userId }) {
    return this.db.query(
      `UPDATE users
         SET google_id=$1,
             name=COALESCE($2, name),
             avatar_url=COALESCE($3, avatar_url)
       WHERE id=$4`,
      [googleId, name, avatarUrl, userId]
    );
  }

  updateProfileByUsername({ googleId, email, name, avatarUrl, username }) {
    return this.db.query(
      `UPDATE users
          SET google_id=$1,
              email=COALESCE($2, email),
              name=COALESCE($3, name),
              avatar_url=COALESCE($4, avatar_url)
        WHERE username=$5`,
      [googleId, email, name, avatarUrl, username]
    );
  }

  setPassword(username, hash) {
    return this.db.query("UPDATE users SET password=$1 WHERE username=$2", [hash, username]);
  }

  setMustChangePassword(username, value) {
    return this.db.query("UPDATE users SET must_change_password=$1 WHERE username=$2", [value, username]);
  }

  setEmail(username, email) {
    return this.db.query("UPDATE users SET email=$1 WHERE username=$2", [email, username]);
  }

  async getPublicProfile(username) {
    const { rows } = await this.db.query(
<<<<<<< HEAD
      "SELECT id, username, email, name, avatar_url, must_change_password FROM users WHERE username=$1",
=======
      "SELECT username, email, name, avatar_url, must_change_password FROM users WHERE username=$1",
>>>>>>> origin/main
      [username]
    );
    return rows[0] || null;
  }

  updatePasswordAndClearFlag(userId, newHash) {
    return this.db.query(
      "UPDATE users SET password=$1, must_change_password=false, updated_at=NOW() WHERE id=$2",
      [newHash, userId]
    );
  }

  // ---------------------------
  // TASKS: Queries & Commands
  // ---------------------------

  /**
   * Create a task for a user.
   * At least one of timer/counter must be provided (enforced by CHECK).
   */
  createTask({ userId, activityName, timer = null, counter = null, deadlineDate = null, repeat = null }) {
    return this.db.query(
      `INSERT INTO tasks (user_id, activity_name, timer, counter, deadline_date, repeat)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [userId, activityName, timer, counter, deadlineDate, repeat]
    );
  }

  /**
   * List tasks for a user (optionally filter by repeat).
   */
  listTasksByUser({ userId, repeat = null }) {
    if (repeat) {
      return this.db.query(
        `SELECT * FROM tasks
          WHERE user_id=$1 AND repeat=$2
          ORDER BY deadline_date NULLS LAST, id`,
        [userId, repeat]
      );
    }
    return this.db.query(
      `SELECT * FROM tasks
        WHERE user_id=$1
        ORDER BY deadline_date NULLS LAST, id`,
      [userId]
    );
  }

  /**
   * Update a task (partial).
   * Pass `null` for timer/counter to clear them (still must satisfy the CHECK).
   */
  updateTask({ taskId, userId, activityName, timer, counter, deadlineDate, repeat }) {
    return this.db.query(
      `UPDATE tasks
          SET activity_name = COALESCE($3, activity_name),
              timer         = $4,
              counter       = $5,
              deadline_date = $6,
              repeat        = $7
        WHERE id=$1 AND user_id=$2
        RETURNING *`,
      [
        taskId,
        userId,
        activityName ?? null,
        timer ?? null,
        counter ?? null,
        deadlineDate ?? null,
        repeat ?? null,
      ]
    );
  }

  /**
   * Delete a task for a user.
   */
  deleteTask({ taskId, userId }) {
    return this.db.query("DELETE FROM tasks WHERE id=$1 AND user_id=$2", [taskId, userId]);
  }
<<<<<<< HEAD

  // ---------------------------
  // HABIT_LOGS: Generators & Write/Read APIs
  // ---------------------------

  /**
   * Generate future occurrences for a user's repeating tasks into habit_logs.
   * horizonDays: how far ahead to generate (default 60 days).
   * Creates rows only if missing (UNIQUE(task_id, occurred_on) protects duplicates).
   */
  async generateOccurrences({ userId, horizonDays = 60 }) {
    // DAILY
    await this.db.query(
      `
      WITH params AS (
        SELECT $1::int AS user_id, $2::int AS horizon
      ),
      days AS (
        SELECT (CURRENT_DATE + i)::date AS d
        FROM generate_series(0, (SELECT horizon FROM params)) AS gs(i)
      )
      INSERT INTO habit_logs (user_id, task_id, occurred_on)
      SELECT t.user_id, t.id, d.d
      FROM tasks t
      JOIN days d ON t.repeat = 'daily'
      WHERE t.user_id = (SELECT user_id FROM params)
        AND (t.deadline_date IS NULL OR d.d >= t.deadline_date)
      ON CONFLICT (task_id, occurred_on) DO NOTHING
      `,
      [userId, horizonDays]
    );

    // WEEKLY (same weekday as the task's deadline_date; if null, use today's weekday)
    await this.db.query(
      `
      WITH params AS (
        SELECT $1::int AS user_id, $2::int AS horizon
      ),
      anchors AS (
        SELECT
          t.id AS task_id,
          t.user_id,
          COALESCE(t.deadline_date, CURRENT_DATE) AS anchor,
          EXTRACT(DOW FROM COALESCE(t.deadline_date, CURRENT_DATE))::int AS dow
        FROM tasks t
        WHERE t.user_id = (SELECT user_id FROM params) AND t.repeat = 'weekly'
      ),
      weeks AS (
        SELECT
          a.task_id, a.user_id,
          (date_trunc('week', CURRENT_DATE)::date + a.dow + (7 * i))::date AS d
        FROM anchors a
        CROSS JOIN generate_series(0, CEIL((SELECT horizon FROM params) / 7.0)::int) AS gs(i)
      )
      INSERT INTO habit_logs (user_id, task_id, occurred_on)
      SELECT w.user_id, w.task_id, w.d
      FROM weeks w
      JOIN tasks t ON t.id = w.task_id
      WHERE w.d >= COALESCE(t.deadline_date, CURRENT_DATE)
      ON CONFLICT (task_id, occurred_on) DO NOTHING
      `,
      [userId, horizonDays]
    );

    // MONTHLY (same day-of-month as deadline_date)
    await this.db.query(
      `
      WITH params AS (
        SELECT $1::int AS user_id, $2::int AS horizon
      ),
      anchors AS (
        SELECT t.id AS task_id, t.user_id, COALESCE(t.deadline_date, CURRENT_DATE)::date AS anchor
        FROM tasks t
        WHERE t.user_id = (SELECT user_id FROM params) AND t.repeat = 'monthly'
      ),
      months AS (
        SELECT
          a.task_id, a.user_id,
          (a.anchor + (INTERVAL '1 month' * i))::date AS d
        FROM anchors a
        CROSS JOIN generate_series(0, CEIL((SELECT horizon FROM params) / 30.0)::int) gs(i)
      )
      INSERT INTO habit_logs (user_id, task_id, occurred_on)
      SELECT m.user_id, m.task_id, m.d
      FROM months m
      JOIN tasks t ON t.id = m.task_id
      WHERE m.d >= COALESCE(t.deadline_date, CURRENT_DATE)
      ON CONFLICT (task_id, occurred_on) DO NOTHING
      `,
      [userId, horizonDays]
    );

    // YEARLY (same month/day as deadline_date)
    await this.db.query(
      `
      WITH params AS (
        SELECT $1::int AS user_id, $2::int AS horizon
      ),
      anchors AS (
        SELECT t.id AS task_id, t.user_id, COALESCE(t.deadline_date, CURRENT_DATE)::date AS anchor
        FROM tasks t
        WHERE t.user_id = (SELECT user_id FROM params) AND t.repeat = 'yearly'
      ),
      years AS (
        SELECT
          a.task_id, a.user_id,
          (a.anchor + (INTERVAL '1 year' * i))::date AS d
        FROM anchors a
        CROSS JOIN generate_series(0, GREATEST(1, CEIL((SELECT horizon FROM params) / 365.0)::int)) gs(i)
      )
      INSERT INTO habit_logs (user_id, task_id, occurred_on)
      SELECT y.user_id, y.task_id, y.d
      FROM years y
      JOIN tasks t ON t.id = y.task_id
      WHERE y.d >= COALESCE(t.deadline_date, CURRENT_DATE)
      ON CONFLICT (task_id, occurred_on) DO NOTHING
      `,
      [userId, horizonDays]
    );
  }

  /**
   * Ensure a single log row exists for (user, task, date).
   * Safe to call before markComplete; uses ON CONFLICT DO NOTHING.
   */
  upsertLogForDate({ userId, taskId, date }) {
    return this.db.query(
      `
      INSERT INTO habit_logs (user_id, task_id, occurred_on)
      VALUES ($1, $2, $3::date)
      ON CONFLICT (task_id, occurred_on) DO NOTHING
      `,
      [userId, taskId, date]
    );
  }

  /**
   * Mark a habit as completed for a given date. Idempotent.
   * Optionally record seconds_logged (stores the greater of existing vs new).
   */
  async markComplete({ userId, taskId, date, secondsLogged = null }) {
    await this.upsertLogForDate({ userId, taskId, date });
    if (secondsLogged == null) {
      return this.db.query(
        `
        UPDATE habit_logs
           SET completed = TRUE,
               completed_at = NOW()
         WHERE user_id = $1 AND task_id = $2 AND occurred_on = $3::date
        `,
        [userId, taskId, date]
      );
    } else {
      return this.db.query(
        `
        UPDATE habit_logs
           SET completed = TRUE,
               completed_at = NOW(),
               seconds_logged = GREATEST(COALESCE(seconds_logged, 0), $4::int)
         WHERE user_id = $1 AND task_id = $2 AND occurred_on = $3::date
        `,
        [userId, taskId, date, secondsLogged]
      );
    }
  }

  /**
   * Get the "agenda" for a given date: what habits occur on that day and status.
   */
  getAgendaForDate({ userId, date }) {
    return this.db.query(
      `
      SELECT
        t.id AS task_id,
        t.activity_name,
        t.timer,
        t.counter,
        t.repeat,
        hl.occurred_on AS date,
        COALESCE(hl.completed, FALSE) AS completed,
        hl.completed_at,
        hl.seconds_logged
      FROM tasks t
      LEFT JOIN habit_logs hl
        ON hl.task_id = t.id AND hl.occurred_on = $2::date
      WHERE t.user_id = $1
        AND (
          (t.repeat IS NULL AND t.deadline_date = $2::date) OR
          (t.repeat = 'daily') OR
          (t.repeat = 'weekly' AND EXTRACT(DOW FROM COALESCE(t.deadline_date, $2::date)) = EXTRACT(DOW FROM $2::date)) OR
          (t.repeat = 'monthly' AND t.deadline_date IS NOT NULL AND EXTRACT(DAY FROM t.deadline_date) = EXTRACT(DAY FROM $2::date)) OR
          (t.repeat = 'yearly'  AND t.deadline_date IS NOT NULL
             AND EXTRACT(MONTH FROM t.deadline_date) = EXTRACT(MONTH FROM $2::date)
             AND EXTRACT(DAY   FROM t.deadline_date) = EXTRACT(DAY   FROM $2::date))
        )
      ORDER BY t.activity_name
      `,
      [userId, date]
    );
  }

  /**
   * Completion rate by day over the last N days (default: 14).
   * Returns rows: day, total, done, pct_done
   */
  getDailyCompletion({ userId, days = 14 }) {
    return this.db.query(
      `
      WITH days AS (
        SELECT generate_series(CURRENT_DATE - ($2::int - 1) * INTERVAL '1 day', CURRENT_DATE, INTERVAL '1 day')::date AS day
      ),
      agg AS (
        SELECT hl.occurred_on AS day,
               COUNT(*) AS total,
               COUNT(*) FILTER (WHERE completed) AS done
        FROM habit_logs hl
        WHERE hl.user_id = $1
          AND hl.occurred_on BETWEEN CURRENT_DATE - ($2::int - 1) * INTERVAL '1 day' AND CURRENT_DATE
        GROUP BY hl.occurred_on
      )
      SELECT
        d.day,
        COALESCE(a.total,0) AS total,
        COALESCE(a.done,0)  AS done,
        CASE WHEN COALESCE(a.total,0)=0 THEN 0
             ELSE ROUND(100.0 * a.done / a.total, 1)
        END AS pct_done
      FROM days d
      LEFT JOIN agg a USING (day)
      ORDER BY d.day
      `,
      [userId, days]
    );
  }

  /**
   * Completion rate by ISO week over the last N weeks (default: 8).
   * Returns rows: wk_start, total, done, pct_done
   */
  getWeeklyCompletion({ userId, weeks = 8 }) {
    return this.db.query(
      `
      WITH weeks AS (
        SELECT date_trunc('week', (CURRENT_DATE - (i*7))::date)::date AS wk_start
        FROM generate_series(0, $2::int-1) AS g(i)
      ),
      agg AS (
        SELECT date_trunc('week', occurred_on)::date AS wk_start,
               COUNT(*) AS total,
               COUNT(*) FILTER (WHERE completed) AS done
        FROM habit_logs
        WHERE user_id = $1
          AND occurred_on >= (SELECT MIN(wk_start) FROM weeks)
        GROUP BY 1
      )
      SELECT
        w.wk_start,
        COALESCE(a.total,0) AS total,
        COALESCE(a.done,0)  AS done,
        CASE WHEN COALESCE(a.total,0)=0 THEN 0
             ELSE ROUND(100.0 * a.done / a.total, 1)
        END AS pct_done
      FROM weeks w
      LEFT JOIN agg a USING (wk_start)
      ORDER BY w.wk_start
      `,
      [userId, weeks]
    );
  }

  /**
   * Current streak length (in days) per habit for this user.
   * Returns: task_id, activity_name, current_streak_days
   */
  getCurrentStreaks({ userId }) {
    return this.db.query(
      `
      WITH user_occ AS (
        SELECT t.id AS task_id, t.activity_name, hl.occurred_on, hl.completed
        FROM tasks t
        JOIN habit_logs hl ON hl.task_id = t.id
        WHERE t.user_id = $1
      ),
      marks AS (
        SELECT
          uo.task_id,
          uo.activity_name,
          uo.occurred_on,
          uo.completed,
          SUM(CASE WHEN NOT uo.completed THEN 1 ELSE 0 END)
            OVER (PARTITION BY uo.task_id ORDER BY uo.occurred_on DESC
                  ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS blockers_from_end
        FROM user_occ uo
      )
      SELECT
        task_id,
        activity_name,
        COALESCE(SUM(CASE WHEN completed AND blockers_from_end = 0 THEN 1 ELSE 0 END), 0) AS current_streak_days
      FROM marks
      GROUP BY task_id, activity_name
      ORDER BY current_streak_days DESC, activity_name
      `,
      [userId]
    );
  }

  /**
   * Best (all-time max) streak per habit.
   * Returns: task_id, activity_name, best_streak_days
   */
  getBestStreaks({ userId }) {
    return this.db.query(
      `
      WITH comp AS (
        SELECT task_id, occurred_on
        FROM habit_logs
        WHERE user_id = $1 AND completed = TRUE
      ),
      grp AS (
        SELECT
          task_id,
          occurred_on,
          occurred_on - (ROW_NUMBER() OVER (PARTITION BY task_id ORDER BY occurred_on))::int * INTERVAL '1 day' AS grp_key
        FROM comp
      ),
      lens AS (
        SELECT task_id, COUNT(*) AS streak_len
        FROM grp
        GROUP BY task_id, grp_key
      )
      SELECT t.id AS task_id, t.activity_name, COALESCE(MAX(l.streak_len), 0) AS best_streak_days
      FROM tasks t
      LEFT JOIN lens l ON l.task_id = t.id
      WHERE t.user_id = $1
      GROUP BY t.id, t.activity_name
      ORDER BY best_streak_days DESC, t.activity_name
      `,
      [userId]
    );
  }

  /**
 * Overall daily streak across any habit (current & best).
 * Returns one row: { current_streak_days, best_streak_days }
 */
getOverallDailyStreak({ userId }) {
  return this.db.query(
    `
    WITH finished AS (
      SELECT DISTINCT occurred_on
      FROM habit_logs
      WHERE user_id = $1 AND completed = TRUE
    ),
    groups AS (
      SELECT
        occurred_on,
        occurred_on - (ROW_NUMBER() OVER (ORDER BY occurred_on))::int * INTERVAL '1 day' AS grp
      FROM finished
    ),
    lengths AS (
      SELECT COUNT(*) AS streak_len
      FROM groups
      GROUP BY grp
    ),
    current_run AS (
      -- walk backwards from today until the first missed day
      SELECT COUNT(*) AS len
      FROM generate_series(0, 5000) AS g(offset)
      WHERE (CURRENT_DATE - g.offset) IN (SELECT occurred_on FROM finished)
      AND NOT EXISTS (
        SELECT 1
        FROM generate_series(0, g.offset) x(o)
        WHERE (CURRENT_DATE - x.o) NOT IN (SELECT occurred_on FROM finished)
      )
    )
    SELECT
      COALESCE((SELECT len FROM current_run LIMIT 1), 0) AS current_streak_days,
      COALESCE((SELECT MAX(streak_len) FROM lengths), 0) AS best_streak_days
    `,
    [userId]
  );
}

=======
>>>>>>> origin/main
}

module.exports = UserRepository;
