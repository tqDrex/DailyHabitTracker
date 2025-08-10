// infra/database.js
const { Pool } = require("pg");

class Database {
  constructor(pgConfig) { this.pool = new Pool(pgConfig); }
  async connect() { await this.pool.query("SELECT 1"); console.log("Connected to database"); }
  query(text, params) { return this.pool.query(text, params); }
}

module.exports = Database;
