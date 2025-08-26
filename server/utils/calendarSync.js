// utils/calendarSync.js
const { google } = require("googleapis");
const CONFIG = require("../utils/config");

// Build an authorized Calendar client from a *full* user row
function getCalendarClient(user) {
  const oauth = new google.auth.OAuth2(
    CONFIG.GOOGLE.CLIENT_ID,
    CONFIG.GOOGLE.CLIENT_SECRET,
    CONFIG.OAUTH_CALLBACK_URL
  );
  oauth.setCredentials({
    access_token: user.google_access_token || undefined,
    refresh_token: user.google_refresh_token || undefined,
    expiry_date: user.google_token_expiry ? new Date(user.google_token_expiry).getTime() : undefined,
  });
  return google.calendar({ version: "v3", auth: oauth });
}

// Translate your DB task row → Google Calendar event
function buildEventFromTask(task, timeZone = "America/New_York") {
  const start = task.deadline_date ? new Date(task.deadline_date) : new Date();
  const end = new Date(start.getTime() + 60 * 60 * 1000); // default 1 hr

  const event = {
    summary: task.activity_name,
    start: { dateTime: start.toISOString(), timeZone },
    end:   { dateTime: end.toISOString(),   timeZone },
  };

  // Your schema uses: 'daily' | 'weekly' | 'monthly' | 'yearly' | null
  if (task.repeat) {
    event.recurrence = [`RRULE:FREQ=${task.repeat.toUpperCase()}`];
  }
  return event;
}

module.exports = { getCalendarClient, buildEventFromTask };
