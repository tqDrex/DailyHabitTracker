// infra/database.js
const { Pool } = require("pg");

class Database {
  constructor() { this.pool = new Pool({
      user: process.env.user,
      host: process.env.host,
      database: process.env.database,
      password: process.env.password,
      port: process.env.port,
      ssl: { rejectUnauthorized: false }}); }
  async connect() { await this.pool.query("SELECT 1"); console.log("Connected to database"); }
  query(text, params) { return this.pool.query(text, params); }
}

module.exports = Database;
