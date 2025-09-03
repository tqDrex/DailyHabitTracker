// domain/userRepo.js
const { Client } = require("pg");

/**
 * UserRepository — data access & schema management for users, tasks, and habit logs.
 */
class UserRepository {
  constructor(db) {
    this.db = db; // a pg.Pool or any object exposing .query(sql, params)
  }

  // ---------------------------
  // DB bootstrap helpers
  // ---------------------------
  static async ensureLocalDatabase(cfg) {
    const {
      user,
      password = undefined,
      host = process.env.host,
      port = process.env.port,
      dbName = process.env.database,
    } = cfg;

    const admin = new Client({ user, password, host, port, database: "postgres" });
    await admin.connect();
    try {
      const { rows } = await admin.query(
        "SELECT 1 FROM pg_database WHERE datname = $1",
        [dbName]
      );
      if (rows.length === 0) {
        await admin.query(`CREATE DATABASE "${dbName}"`);
      }
    } finally {
      await admin.end();
    }
  }

  async ensureSchema() {
    const lockKey = 873245901;
    await this.db.query("SELECT pg_advisory_lock($1)", [lockKey]);
    await this.db.query("BEGIN");
    try {
      // USERS
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

      await this.db.query(`UPDATE users SET must_change_password = COALESCE(must_change_password, false)`);
      await this.db.query(`ALTER TABLE users ALTER COLUMN must_change_password SET DEFAULT false`);
      await this.db.query(`ALTER TABLE users ALTER COLUMN must_change_password SET NOT NULL`);

      await this.db.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM users WHERE password IS NULL) THEN
            ALTER TABLE users ALTER COLUMN password SET NOT NULL;
          END IF;
        END$$;
      `);

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

      await this.db.query(`CREATE INDEX IF NOT EXISTS users_username_idx ON users (username)`);
      await this.db.query(`CREATE INDEX IF NOT EXISTS users_email_idx ON users (email)`);

      // EMAIL_VERIFICATIONS
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
      await this.db.query(`CREATE INDEX IF NOT EXISTS ev_username_consumed_idx ON email_verifications (username, consumed)`);
      await this.db.query(`CREATE INDEX IF NOT EXISTS ev_expires_at_idx ON email_verifications (expires_at)`);

      // TASKS
      await this.db.query(`
        CREATE TABLE IF NOT EXISTS tasks (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          activity_name TEXT NOT NULL,
          timer INTEGER,
          counter INTEGER,
          deadline_date DATE,
          repeat TEXT, -- daily | weekly | monthly | yearly

          CONSTRAINT tasks_timer_counter_check CHECK (timer IS NOT NULL OR counter IS NOT NULL),
          CONSTRAINT tasks_timer_nonneg CHECK (timer IS NULL OR timer >= 0),
          CONSTRAINT tasks_counter_nonneg CHECK (counter IS NULL OR counter >= 0),
          CONSTRAINT tasks_repeat_check CHECK (repeat IS NULL OR repeat IN ('daily','weekly','monthly','yearly'))
        )
      `);
      await this.db.query(`CREATE INDEX IF NOT EXISTS tasks_user_id_idx ON tasks (user_id)`);
      await this.db.query(`CREATE INDEX IF NOT EXISTS tasks_deadline_date_idx ON tasks (deadline_date)`);

      // HABIT_LOGS
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

      await this.db.query("COMMIT");
    } catch (e) {
      await this.db.query("ROLLBACK");
      await this.db.query("SELECT pg_advisory_unlock($1)", [lockKey]);
      throw e;
    }
    await this.db.query("SELECT pg_advisory_unlock($1)", [lockKey]);
  }

  // ---------------------------
  // USERS
  // ---------------------------
  getById(id) { return this.db.query("SELECT * FROM users WHERE id=$1", [id]); }
  getByUsername(username) { return this.db.query("SELECT * FROM users WHERE username=$1", [username]); }
  getByEmail(email) { return this.db.query("SELECT * FROM users WHERE email=$1", [email]); }
  getByGoogleId(googleId) { return this.db.query("SELECT * FROM users WHERE google_id=$1", [googleId]); }

  async usernameExists(username) {
    const { rows } = await this.db.query("SELECT 1 FROM users WHERE username=$1", [username]);
    return rows.length > 0;
  }

  createLocal(username, hash) {
    return this.db.query("INSERT INTO users (username, password) VALUES ($1, $2)", [username, hash]);
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
      "SELECT id, username, email, name, avatar_url, must_change_password FROM users WHERE username=$1",
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
  // TASKS
  // ---------------------------
  createTask({ userId, activityName, timer = null, counter = null, deadlineDate = null, repeat = null }) {
    return this.db.query(
      `INSERT INTO tasks (user_id, activity_name, timer, counter, deadline_date, repeat)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [userId, activityName, timer, counter, deadlineDate, repeat]
    );
  }

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

  deleteTask({ taskId, userId }) {
    return this.db.query("DELETE FROM tasks WHERE id=$1 AND user_id=$2", [taskId, userId]);
  }

  // ---------------------------
  // HABIT_LOGS: generation & APIs
  // ---------------------------

  /**
   * Generate upcoming occurrences from TODAY forward.
   * If a task has a deadline_date, only generate dates <= deadline_date.
   */
  async generateOccurrences({ userId, horizonDays = 60 }) {
    // DAILY
    await this.db.query(
      `
      WITH params AS (SELECT $1::int AS user_id, $2::int AS horizon),
      days AS (
        SELECT (CURRENT_DATE + i)::date AS d
        FROM generate_series(0, (SELECT horizon FROM params)) AS gs(i)
      )
      INSERT INTO habit_logs (user_id, task_id, occurred_on)
      SELECT t.user_id, t.id, d.d
      FROM tasks t
      JOIN days d ON t.repeat = 'daily'
      WHERE t.user_id = (SELECT user_id FROM params)
        AND (t.deadline_date IS NULL OR d.d <= t.deadline_date)
      ON CONFLICT (task_id, occurred_on) DO NOTHING
      `,
      [userId, horizonDays]
    );

    // WEEKLY (anchor = today’s weekday)
    await this.db.query(
      `
      WITH params AS (SELECT $1::int AS user_id, $2::int AS horizon),
      anchors AS (
        SELECT t.id AS task_id, t.user_id,
               CURRENT_DATE::date AS anchor,
               EXTRACT(DOW FROM CURRENT_DATE)::int AS dow
        FROM tasks t
        WHERE t.user_id = (SELECT user_id FROM params) AND t.repeat = 'weekly'
      ),
      weeks AS (
        SELECT a.task_id, a.user_id,
               (date_trunc('week', CURRENT_DATE)::date + a.dow + (7 * i))::date AS d
        FROM anchors a
        CROSS JOIN generate_series(0, CEIL((SELECT horizon FROM params) / 7.0)::int) AS gs(i)
      )
      INSERT INTO habit_logs (user_id, task_id, occurred_on)
      SELECT w.user_id, w.task_id, w.d
      FROM weeks w
      JOIN tasks t ON t.id = w.task_id
      WHERE w.d >= CURRENT_DATE
        AND (t.deadline_date IS NULL OR w.d <= t.deadline_date)
      ON CONFLICT (task_id, occurred_on) DO NOTHING
      `,
      [userId, horizonDays]
    );

    // MONTHLY (anchor = today)
    await this.db.query(
      `
      WITH params AS (SELECT $1::int AS user_id, $2::int AS horizon),
      anchors AS (
        SELECT t.id AS task_id, t.user_id, CURRENT_DATE::date AS anchor
        FROM tasks t
        WHERE t.user_id = (SELECT user_id FROM params) AND t.repeat = 'monthly'
      ),
      months AS (
        SELECT a.task_id, a.user_id, (a.anchor + (INTERVAL '1 month' * i))::date AS d
        FROM anchors a
        CROSS JOIN generate_series(0, CEIL((SELECT horizon FROM params) / 30.0)::int) gs(i)
      )
      INSERT INTO habit_logs (user_id, task_id, occurred_on)
      SELECT m.user_id, m.task_id, m.d
      FROM months m
      JOIN tasks t ON t.id = m.task_id
      WHERE m.d >= CURRENT_DATE
        AND (t.deadline_date IS NULL OR m.d <= t.deadline_date)
      ON CONFLICT (task_id, occurred_on) DO NOTHING
      `,
      [userId, horizonDays]
    );

    // YEARLY (anchor = today)
    await this.db.query(
      `
      WITH params AS (SELECT $1::int AS user_id, $2::int AS horizon),
      anchors AS (
        SELECT t.id AS task_id, t.user_id, CURRENT_DATE::date AS anchor
        FROM tasks t
        WHERE t.user_id = (SELECT user_id FROM params) AND t.repeat = 'yearly'
      ),
      years AS (
        SELECT a.task_id, a.user_id, (a.anchor + (INTERVAL '1 year' * i))::date AS d
        FROM anchors a
        CROSS JOIN generate_series(0, GREATEST(1, CEIL((SELECT horizon FROM params) / 365.0)::int)) gs(i)
      )
      INSERT INTO habit_logs (user_id, task_id, occurred_on)
      SELECT y.user_id, y.task_id, y.d
      FROM years y
      JOIN tasks t ON t.id = y.task_id
      WHERE y.d >= CURRENT_DATE
        AND (t.deadline_date IS NULL OR y.d <= t.deadline_date)
      ON CONFLICT (task_id, occurred_on) DO NOTHING
      `,
      [userId, horizonDays]
    );
  }

  // Generate for a single task, with anchorDate defaulting to today.
  async generateOccurrencesForTask({ userId, taskId, repeat, anchorDate = null, horizonDays = 60, deadlineDate = null }) {
    const anchor = anchorDate || "CURRENT_DATE";

    if (repeat === 'daily') {
      await this.db.query(
        `
        WITH params AS (
          SELECT $1::int AS user_id, $2::int AS task_id, ${anchor}::date AS anchor, $3::int AS horizon
        ),
        days AS (
          SELECT (anchor + i)::date AS d
          FROM params, generate_series(0, (SELECT horizon FROM params)) AS gs(i)
        )
        INSERT INTO habit_logs (user_id, task_id, occurred_on)
        SELECT (SELECT user_id FROM params), (SELECT task_id FROM params), d.d
        FROM days d
        WHERE $4::date IS NULL OR d.d <= $4::date
        ON CONFLICT (task_id, occurred_on) DO NOTHING
        `,
        [userId, taskId, horizonDays, deadlineDate]
      );
      return;
    }

    if (repeat === 'weekly') {
      await this.db.query(
        `
        WITH params AS (
          SELECT $1::int AS user_id, $2::int AS task_id, ${anchor}::date AS anchor, $3::int AS horizon
        ),
        seq AS (SELECT generate_series(0, CEIL((SELECT horizon FROM params)/7.0)::int) AS i),
        weeks AS (
          SELECT ( date_trunc('week', (SELECT anchor FROM params))::date
                   + EXTRACT(DOW FROM (SELECT anchor FROM params))::int
                   + (7 * i) )::date AS d
          FROM seq
        )
        INSERT INTO habit_logs (user_id, task_id, occurred_on)
        SELECT (SELECT user_id FROM params), (SELECT task_id FROM params), w.d
        FROM weeks w
        WHERE w.d >= (SELECT anchor FROM params)
          AND ($4::date IS NULL OR w.d <= $4::date)
        ON CONFLICT (task_id, occurred_on) DO NOTHING
        `,
        [userId, taskId, horizonDays, deadlineDate]
      );
      return;
    }

    if (repeat === 'monthly') {
      await this.db.query(
        `
        WITH params AS (
          SELECT $1::int AS user_id, $2::int AS task_id, ${anchor}::date AS anchor, $3::int AS horizon
        ),
        months AS (
          SELECT ((SELECT anchor FROM params) + (INTERVAL '1 month' * i))::date AS d
          FROM generate_series(0, CEIL((SELECT horizon FROM params)/30.0)::int) AS gs(i)
        )
        INSERT INTO habit_logs (user_id, task_id, occurred_on)
        SELECT (SELECT user_id FROM params), (SELECT task_id FROM params), m.d
        FROM months m
        WHERE m.d >= (SELECT anchor FROM params)
          AND ($4::date IS NULL OR m.d <= $4::date)
        ON CONFLICT (task_id, occurred_on) DO NOTHING
        `,
        [userId, taskId, horizonDays, deadlineDate]
      );
      return;
    }

    if (repeat === 'yearly') {
      await this.db.query(
        `
        WITH params AS (
          SELECT $1::int AS user_id, $2::int AS task_id, ${anchor}::date AS anchor, $3::int AS horizon
        ),
        years AS (
          SELECT ((SELECT anchor FROM params) + (INTERVAL '1 year' * i))::date AS d
          FROM generate_series(0, GREATEST(1, CEIL((SELECT horizon FROM params)/365.0)::int)) AS gs(i)
        )
        INSERT INTO habit_logs (user_id, task_id, occurred_on)
        SELECT (SELECT user_id FROM params), (SELECT task_id FROM params), y.d
        FROM years y
        WHERE y.d >= (SELECT anchor FROM params)
          AND ($4::date IS NULL OR y.d <= $4::date)
        ON CONFLICT (task_id, occurred_on) DO NOTHING
        `,
        [userId, taskId, horizonDays, deadlineDate]
      );
      return;
    }

    // one-off task: just create the anchor occurrence
    await this.db.query(
      `
      INSERT INTO habit_logs (user_id, task_id, occurred_on)
      VALUES ($1, $2, COALESCE($3::date, CURRENT_DATE))
      ON CONFLICT (task_id, occurred_on) DO NOTHING
      `,
      [userId, taskId, anchorDate]
    );
  }

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

  async markComplete({ userId, taskId, date, secondsLogged = null }) {
    await this.upsertLogForDate({ userId, taskId, date });
    if (secondsLogged == null) {
      return this.db.query(
        `UPDATE habit_logs
           SET completed = TRUE, completed_at = NOW()
         WHERE user_id = $1 AND task_id = $2 AND occurred_on = $3::date`,
        [userId, taskId, date]
      );
    } else {
      return this.db.query(
        `UPDATE habit_logs
           SET completed = TRUE,
               completed_at = NOW(),
               seconds_logged = GREATEST(COALESCE(seconds_logged, 0), $4::int)
         WHERE user_id = $1 AND task_id = $2 AND occurred_on = $3::date`,
        [userId, taskId, date, secondsLogged]
      );
    }
  }

  // Idempotent set/unset completion used by routes
  async setCompletion({ userId, taskId, date, completed, secondsLogged }) {
    const sql = `
      INSERT INTO habit_logs (user_id, task_id, occurred_on, completed, completed_at, seconds_logged)
      VALUES ($1, $2, $3::date, $4, CASE WHEN $4 THEN NOW() ELSE NULL END, $5)
      ON CONFLICT (task_id, occurred_on)
      DO UPDATE SET
        completed     = EXCLUDED.completed,
        completed_at  = CASE WHEN EXCLUDED.completed THEN NOW() ELSE NULL END,
        seconds_logged= COALESCE(EXCLUDED.seconds_logged, habit_logs.seconds_logged)
      RETURNING *;
    `;
    const { rows } = await this.db.query(sql, [
      userId,
      taskId,
      date,
      completed,
      secondsLogged ?? null,
    ]);
    return rows[0];
  }

  // Habits listing for a day used by GET /habits/day
  async listHabitsForDay({ userId, date }) {
    const sql = `
      SELECT t.id AS task_id,
             t.activity_name,
             COALESCE(l.completed, false) AS completed,
             l.seconds_logged,
             l.completed_at
      FROM tasks t
      LEFT JOIN habit_logs l
        ON l.task_id = t.id AND l.occurred_on = $2::date
      WHERE t.user_id = $1
      ORDER BY t.id;
    `;
    const { rows } = await this.db.query(sql, [userId, date]);
    return rows;
  }

  // Current streak for a single habit
  async getCurrentStreak({ userId, taskId }) {
    const sql = `
      WITH days AS (
        SELECT generate_series(current_date, current_date - interval '365 days', interval '-1 day')::date AS d
      ),
      marks AS (
        SELECT d.d, COALESCE(l.completed,false) AS completed
        FROM days d
        LEFT JOIN habit_logs l
          ON l.task_id=$2 AND l.user_id=$1 AND l.occurred_on=d.d
        ORDER BY d.d DESC
      ),
      run AS (
        SELECT d, completed,
               SUM(CASE WHEN completed THEN 0 ELSE 1 END)
                 OVER (ORDER BY d DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS grp
        FROM marks
      )
      SELECT COALESCE(COUNT(*),0) AS current_streak
      FROM run
      WHERE grp=0 AND completed=true;
    `;
    const { rows } = await this.db.query(sql, [userId, taskId]);
    return Number(rows[0]?.current_streak || 0);
  }

  // Agenda for a specific date
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
          (t.repeat = 'weekly' AND EXTRACT(DOW FROM COALESCE($2::date, CURRENT_DATE)) = EXTRACT(DOW FROM $2::date)) OR
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

  // Classic completion stats
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

  // ---------------------------
  // NEW: Percent-progress (for charts)
  // ---------------------------
  getDailyProgress({ userId, days = 14 }) {
    return this.db.query(
      `
      WITH bounds AS (
        SELECT generate_series(
          (CURRENT_DATE - ($2::int - 1) * INTERVAL '1 day')::date,
          CURRENT_DATE,
          INTERVAL '1 day'
        )::date AS d
      )
      SELECT
        b.d AS date,
        t.id AS task_id,
        t.activity_name,
        t.timer,
        t.counter,
        COALESCE(SUM(CASE WHEN p.type = 'minutes' THEN p.value END),0)::int AS progress_minutes,
        COALESCE(SUM(CASE WHEN p.type = 'count'   THEN p.value END),0)::int AS progress_count,
        LEAST(
          1.0,
          CASE
            WHEN t.timer IS NOT NULL AND t.timer > 0
              THEN COALESCE(SUM(CASE WHEN p.type='minutes' THEN p.value END),0)::float / t.timer
            WHEN t.counter IS NOT NULL AND t.counter > 0
              THEN COALESCE(SUM(CASE WHEN p.type='count' THEN p.value END),0)::float / t.counter
            ELSE 0
          END
        ) AS pct
      FROM bounds b
      CROSS JOIN tasks t
      LEFT JOIN task_progress p
        ON p.task_id = t.id
       AND p.user_id = $1
       AND p.at >= b.d::timestamptz
       AND p.at < (b.d + INTERVAL '1 day')::timestamptz
      WHERE t.user_id = $1
      GROUP BY b.d, t.id
      ORDER BY b.d DESC, t.id
      `,
      [userId, days]
    );
  }

  getWeeklyProgress({ userId, weeks = 8 }) {
    return this.db.query(
      `
      WITH weeks AS (
        SELECT date_trunc('week', (CURRENT_DATE - (i*7))::date)::date AS wk_start
        FROM generate_series(0, $2::int-1) AS g(i)
      )
      SELECT
        w.wk_start,
        t.id AS task_id,
        t.activity_name,
        t.timer,
        t.counter,
        COALESCE(SUM(CASE WHEN p.type='minutes' THEN p.value END),0)::int AS progress_minutes,
        COALESCE(SUM(CASE WHEN p.type='count'   THEN p.value END),0)::int AS progress_count,
        LEAST(
          1.0,
          CASE
            WHEN t.timer IS NOT NULL AND t.timer > 0
              THEN COALESCE(SUM(CASE WHEN p.type='minutes' THEN p.value END),0)::float / t.timer
            WHEN t.counter IS NOT NULL AND t.counter > 0
              THEN COALESCE(SUM(CASE WHEN p.type='count' THEN p.value END),0)::float / t.counter
            ELSE 0
          END
        ) AS pct
      FROM weeks w
      CROSS JOIN tasks t
      LEFT JOIN task_progress p
        ON p.task_id = t.id
       AND p.user_id = $1
       AND p.at >= w.wk_start::timestamptz
       AND p.at <  (w.wk_start + INTERVAL '7 days')::timestamptz
      WHERE t.user_id = $1
      GROUP BY w.wk_start, t.id
      ORDER BY w.wk_start DESC, t.id
      `,
      [userId, weeks]
    );
  }

  getMonthlyProgress({ userId, months = 6 }) {
    return this.db.query(
      `
      WITH months AS (
        SELECT date_trunc('month', (CURRENT_DATE - (INTERVAL '1 month' * i)))::date AS m_start
        FROM generate_series(0, $2::int-1) AS g(i)
      )
      SELECT
        m.m_start,
        t.id AS task_id,
        t.activity_name,
        t.timer,
        t.counter,
        COALESCE(SUM(CASE WHEN p.type='minutes' THEN p.value END),0)::int AS progress_minutes,
        COALESCE(SUM(CASE WHEN p.type='count'   THEN p.value END),0)::int AS progress_count,
        LEAST(
          1.0,
          CASE
            WHEN t.timer IS NOT NULL AND t.timer > 0
              THEN COALESCE(SUM(CASE WHEN p.type='minutes' THEN p.value END),0)::float / t.timer
            WHEN t.counter IS NOT NULL AND t.counter > 0
              THEN COALESCE(SUM(CASE WHEN p.type='count' THEN p.value END),0)::float / t.counter
            ELSE 0
          END
        ) AS pct
      FROM months m
      CROSS JOIN tasks t
      LEFT JOIN task_progress p
        ON p.task_id = t.id
       AND p.user_id = $1
       AND p.at >= m.m_start::timestamptz
       AND p.at <  (m.m_start + INTERVAL '1 month')::timestamptz
      WHERE t.user_id = $1
      GROUP BY m.m_start, t.id
      ORDER BY m.m_start DESC, t.id
      `,
      [userId, months]
    );
  }

  // Best streaks / overall streaks (unchanged)
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

  getOverallDailyStreak({ userId }) {
    return this.db.query(
      `
      WITH finished AS (
        SELECT DISTINCT occurred_on
        FROM habit_logs
        WHERE user_id = $1 AND completed = TRUE
      ),
      groups AS (
        SELECT occurred_on,
               occurred_on - (ROW_NUMBER() OVER (ORDER BY occurred_on))::int * INTERVAL '1 day' AS grp
        FROM finished
      ),
      lengths AS (
        SELECT COUNT(*) AS streak_len
        FROM groups
        GROUP BY grp
      ),
      current_run AS (
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
}

module.exports = UserRepository;
