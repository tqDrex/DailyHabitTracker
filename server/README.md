# Server Structure Overview

This README explains the purpose of each folder and file in the `server/` directory.

## Root Files
- **server.js** — Main entry point for the backend. Loads environment variables, sets up the Express app, connects to the database, configures middleware, and mounts routes.
- **passport.js** — Configures Google OAuth2 strategy using `passport-google-oauth20`. Handles login, signup, and account linking via Google.
- **env.json** / **.env** — Environment configuration files. `.env` is for sensitive keys; `env.json` contains structured config for database or app defaults.

## Folders

### prisma/
- **schema.prisma** — Prisma schema definition (database models, relations, datasource).

### routes/
- **auth.js** — Routes for Google OAuth, email verification, user session, and protected resources.
- **local.js** — Routes for local username/password authentication (signup and login). Optional — can be disabled via `AUTH_ALLOW_LOCAL=false`.

### infra/
Contains infrastructure-level services (low-level utilities that interact with external systems).

- **database.js** — PostgreSQL connection pool wrapper using `pg`.
- **mailer.js** — Handles sending emails using `nodemailer`.

### domain/
Contains database-facing repositories that encapsulate SQL queries.

- **userRepo.js** — All SQL queries for reading/writing user records (by id, username, email, Google ID, etc.).

### services/
Contains application-level services with business logic.

- **authService.js** — Manages in-memory login sessions via secure cookies.
- **emailVerificationService.js** — Manages sending and verifying time-limited email codes.

### utils/
Contains helper modules and configuration.

- **config.js** — Centralized environment variable parsing and defaults.
- **validators.js** — Input validation helpers (email format, login payload checks).
- **asyncHandler.js** — Wrapper for Express routes to handle async/await errors.

## Flow Overview
1. **server.js** initializes config, connects DB, sets up `passport.js`, and mounts routes.
2. **passport.js** defines Google strategy logic.
3. Requests flow through **routes/** files, which call services from **services/** and repositories from **domain/**.
4. **infra/** contains reusable low-level tools (database and mail).
5. **utils/** contains generic helpers used across layers.

## Running the Server
```bash
cd server
npm install
npm run start
```
Ensure `.env` contains all required variables:
```
HOSTNAME=localhost
PORT=3000
FRONTEND_URL=http://localhost:3001
OAUTH_CALLBACK_URL=http://localhost:3000/auth/google/callback
AUTH_ALLOW_LOCAL=true

# Database
PGUSER=...
PGPASSWORD=...
PGDATABASE=...
PGHOST=...
PGPORT=5432

# Google OAuth
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

# SMTP
SMTP_HOST=...
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
SMTP_FROM=...
```
