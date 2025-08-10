// domain/userRepo.js
class UserRepository {
  constructor(db) { this.db = db; }
  getById(id) { return this.db.query("SELECT * FROM users WHERE id=$1", [id]); }
  getByUsername(username) { return this.db.query("SELECT * FROM users WHERE username=$1", [username]); }
  getByEmail(email) { return this.db.query("SELECT * FROM users WHERE email=$1", [email]); }
  getByGoogleId(googleId) { return this.db.query("SELECT * FROM users WHERE google_id=$1", [googleId]); }
  async usernameExists(username) {
    const { rows } = await this.db.query("SELECT 1 FROM users WHERE username=$1", [username]);
    return rows.length > 0;
  }
  createLocal(username, hash) {
    return this.db.query("INSERT INTO users (username,password) VALUES ($1,$2)", [username, hash]);
  }
  async createFromGoogle({ username, hash, email, googleId, name, avatarUrl, mustChange = true }) {
    await this.db.query(
      `INSERT INTO users (username,password,email,google_id,name,avatar_url,must_change_password)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [username, hash, email, googleId, name, avatarUrl, mustChange]
    );
    const created = await this.db.query("SELECT * FROM users WHERE username=$1", [username]);
    return created.rows[0];
  }
  linkGoogleToUser({ googleId, name, avatarUrl, userId }) {
    return this.db.query(
      `UPDATE users SET google_id=$1, name=COALESCE($2,name), avatar_url=COALESCE($3,avatar_url)
       WHERE id=$4`,
      [googleId, name, avatarUrl, userId]
    );
  }
  updateProfileByUsername({ googleId, email, name, avatarUrl, username }) {
    return this.db.query(
      `UPDATE users SET google_id=$1, email=COALESCE($2,email), name=COALESCE($3,name),
       avatar_url=COALESCE($4,avatar_url) WHERE username=$5`,
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
      "SELECT username,email,name,avatar_url,must_change_password FROM users WHERE username=$1",
      [username]
    );
    return rows[0] || null;
  }
}

module.exports = UserRepository;
