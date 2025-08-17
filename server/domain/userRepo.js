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
    this.db = db;
  }

  /**
   * Ensure DB schema exists and is in a good state.
   * - Wraps in a transaction
   * - Uses IF NOT EXISTS guards
   * - Adds/repairs constraints/indexes idempotently
   */
  async ensureSchema() {
    // Optional advisory lock to avoid races if multiple instances start together
    await this.db.query("SELECT pg_advisory_lock(873245901)");

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
          updated_at TIMESTAMPTZ DEFAULT NOW()
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

      // Backfill + enforce NOT NULL / defaults where safe
      await this.db.query(`UPDATE users SET must_change_password = COALESCE(must_change_password, false)`);
      await this.db.query(`ALTER TABLE users ALTER COLUMN must_change_password SET DEFAULT false`);
      await this.db.query(`ALTER TABLE users ALTER COLUMN must_change_password SET NOT NULL`);

      // If you *know* every user has a password, you can enforce NOT NULL:
      // Guard to only enforce if no NULLs exist.
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

      // Helpful indexes (idempotent)
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

      // Partial unique index (only one active code per user)
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

      // Commit all schema work
      await this.db.query("COMMIT");
    } catch (e) {
      await this.db.query("ROLLBACK");
      await this.db.query("SELECT pg_advisory_unlock(873245901)");
      throw e;
    }

    await this.db.query("SELECT pg_advisory_unlock(873245901)");
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
    }
  
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
      "SELECT username, email, name, avatar_url, must_change_password FROM users WHERE username=$1",
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
}

module.exports = UserRepository;
