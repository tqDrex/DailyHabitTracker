# DailyHabitTracker

This is a full-stack habit tracking web application with user authentication and calendar features. It consists of:

- A **React.js client** for the user interface  
- An **Express.js server** that handles authentication and database communication with PostgreSQL

---

## 🌟 Features

### ✅ Pages

- **LoginPage** (`Route path="/"`)  
  - Users can log in using their username and password  
  - Credentials are securely validated against the database

- **SignupPage** (`Route path="/signup"`)  
  - New users can create an account with a username and password  
  - Passwords are hashed before being stored in the database

- **DashboardPage** (`Route path="/dashboard"`)  
  - The user's main dashboard (to be customized)

- **CalendarPage** (`Route path="/calendar"`)  
  - A calendar interface for habit tracking (in progress or to be expanded)

---

## 🛠 How to Run the App

### 1. Set up the backend (Express server)

```bash
cd server
```

1. Rename the provided sample config:
```bash
cp env_sample.json env.json
```

2. Edit `env.json` and fill in your PostgreSQL database credentials:

```json
{
  "user": "your_db_username",
  "host": "localhost",
  "database": "your_db_name",
  "password": "your_db_password",
  "port": 5432
}
```

3. Ensure your PostgreSQL instance has the following table created:

```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL
);
```

4. Install dependencies and start the server:

```bash
npm install
node server.js
```

> Ideally, the Express server runs on port `3000`

---

### 2. Set up the frontend (React client)

```bash
cd client
npm install
npm start
```

> Ideally, the React client runs on port `3001` and communicates with the server on `http://localhost:3000`

---

## 📌 Notes

- Make sure PostgreSQL is running locally
- Your `env.json` should be added to `.gitignore` to avoid exposing credentials
- After a successful signup, users will be able to log in and be redirected to the dashboard
