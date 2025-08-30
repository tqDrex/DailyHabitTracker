// src/pages/CalendarPage.jsx
import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { gapi } from "gapi-script";
import Calendar from "react-calendar";
import "react-calendar/dist/Calendar.css";
import Event from "../Components/Event.js";
import "../style/CalendarPage.css";

/* ---------- Small nav button (same pattern as Dashboard/ToDo) ---------- */
function NavButton({ to, children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const isActive = location.pathname === to;
  return (
    <button
      className={`navlink ${isActive ? "navlink--active" : ""}`}
      onClick={() => navigate(to)}
    >
      {children}
    </button>
  );
}

export default function CalendarPage() {
  const [user, setUser] = useState(null);
  const userId = user?.id ?? null;

  // Google calendar
  const [events, setEvents] = useState([]);
  const [calendarId, setCalendarID] = useState(null);
  const [isGapiLoaded, setIsGapiLoaded] = useState(false);
  const [hasGoogleToken, setHasGoogleToken] = useState(false);

  // Habits
  const [habitRows, setHabitRows] = useState([]);
  const [isHabitsLoading, setIsHabitsLoading] = useState(false);

  // UI state
  const [error, setError] = useState(null);
  const [booting, setBooting] = useState(true);

  // Date selectors
  const today = useMemo(() => new Date(), []);
  const [date, setDate] = useState(today);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const isoDate = useMemo(() => date.toISOString().slice(0, 10), [date]);

  // ---------------- Load current user ----------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("http://localhost:3000/api/me", {
          credentials: "include",
        });
        if (!res.ok) throw new Error("Not logged in");
        const me = await res.json();
        if (!cancelled) setUser(me);
      } catch {
        if (!cancelled) setUser(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---------------- Google: list events for the selected day ----------------
  const getEvents = useCallback(
    async (d) => {
      if (!calendarId || !hasGoogleToken || !isGapiLoaded) return;
      const startOfDay = new Date(d);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(d);
      endOfDay.setHours(23, 59, 59, 999);

      try {
        const response = await window.gapi.client.calendar.events.list({
          calendarId,
          timeMin: startOfDay.toISOString(),
          timeMax: endOfDay.toISOString(),
          showDeleted: false,
          singleEvents: true,
          maxResults: 25,
          orderBy: "startTime",
        });
        setEvents(response.result.items || []);
        setError(null);
      } catch (err) {
        console.error("Error fetching events:", err);
        setError("Failed to fetch events. Check your permissions.");
      }
    },
    [calendarId, hasGoogleToken, isGapiLoaded]
  );

  // ---------------- Habits: fetch per-day list ----------------
  const fetchHabitsForDate = useCallback(
    async (dateStr) => {
      if (!userId) return;
      setIsHabitsLoading(true);
      try {
        const u = new URL("http://localhost:3000/habits/day");
        u.searchParams.set("date", dateStr);
        u.searchParams.set("userId", String(userId));
        const res = await fetch(u.toString(), { credentials: "include" });
        if (!res.ok) throw new Error(`Failed to load habits for ${dateStr}`);
        const data = await res.json();
        setHabitRows(data.rows || []);
      } catch (e) {
        console.error(e);
        setError(e.message);
        setHabitRows([]);
      } finally {
        setIsHabitsLoading(false);
      }
    },
    [userId]
  );

  // Toggle a habit’s completion
  const toggleHabit = useCallback(
    async (taskId, nextCompleted) => {
      try {
        const res = await fetch(
          `http://localhost:3000/habits/${taskId}/complete`,
          {
            method: "PUT",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              userId,
              date: isoDate,
              completed: nextCompleted,
              tz,
            }),
          }
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || "Failed to update habit completion");
        }

        await fetchHabitsForDate(isoDate);

        // Notify Dashboard that streaks changed
        window.dispatchEvent(
          new CustomEvent("streaks:changed", {
            detail: { taskId, date: isoDate },
          })
        );
      } catch (e) {
        console.error(e);
        setError(e.message);
      }
    },
    [userId, isoDate, tz, fetchHabitsForDate]
  );

  // ---------------- Bootstrap Google client ----------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const tokenRes = await fetch("http://localhost:3000/api/auth/token", {
          credentials: "include",
        });
        if (tokenRes.ok) {
          const tokenData = await tokenRes.json();
          if (tokenData.accessToken) {
            await new Promise((resolve) => gapi.load("client:auth2", resolve));
            await window.gapi.client.load("calendar", "v3");
            if (cancelled) return;
            setIsGapiLoaded(true);
            gapi.auth.setToken({ access_token: tokenData.accessToken });
            setHasGoogleToken(true);

            const calRes = await fetch(
              "http://localhost:3000/api/calendar/id",
              { credentials: "include" }
            );
            if (calRes.ok) {
              const data = await calRes.json();
              if (!cancelled) setCalendarID(data.calendarId);
            } else if (!cancelled) {
              setCalendarID(null);
            }
          }
        } else {
          setHasGoogleToken(false);
        }
      } catch (err) {
        console.error("Bootstrap (Google) error:", err);
        setError("Failed to load Google Calendar. You can still use habits.");
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (calendarId && hasGoogleToken && isGapiLoaded) {
      getEvents(date);
    }
  }, [calendarId, hasGoogleToken, isGapiLoaded, date, getEvents]);

  useEffect(() => {
    if (userId) fetchHabitsForDate(isoDate);
  }, [isoDate, userId, fetchHabitsForDate]);

  if (booting || !user) return <div className="App py-8">Loading…</div>;

  return (
    <div className="dashboard">
      {/* ---------- Top bar / nav ---------- */}
      <div className="dashboard__topbar">
        <div className="dashboard__brand">Daily Habit Tracker</div>
        <nav className="dashboard__nav">
          <NavButton to="/dashboard">Dashboard</NavButton>
          <NavButton to="/todo">To-Do</NavButton>
          <NavButton to="/calendar">Calendar</NavButton>
        </nav>
      </div>

      {/* ---------- Page body ---------- */}
      <div className="dashboard__container">
        {error && (
          <div className="card card--warn">
            <p className="muted" role="alert">{error}</p>
          </div>
        )}

        <div className="grid grid--2">
          {/* Calendar card */}
          <div className="card p-16">
            <h3 className="mt-0">Calendar</h3>
            {!hasGoogleToken && (
              <p className="caption mb-8">
                Google not linked — habits still available
              </p>
            )}
            <div className="flex flex-col items-center">
              <Calendar onChange={setDate} value={date} />
            </div>
          </div>

          {/* Event list card */}
          <div className="card p-16">
            <h3 className="mt-0">Event list</h3>
            <p className="muted">Events on {date.toDateString()}</p>
            {!hasGoogleToken ? (
              <p className="caption">
                Link Google on your dashboard to see calendar events here.
              </p>
            ) : events.length > 0 ? (
              <ul className="event-list">
                {events.map((evt) => (
                  <li key={evt.id}>
                    <div className="event-card">
                      <Event
                        description={evt.summary || "(no title)"}
                        url={evt.htmlLink || null}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="caption mt-8">No events for this day.</p>
            )}
          </div>
        </div>

        {/* Full-width: Habit list */}
        <div className="card p-16">
          <h3 className="mt-0">Habit list</h3>
          <p className="muted">Habits for {date.toDateString()}</p>
          {isHabitsLoading ? (
            <p className="caption">Loading habits…</p>
          ) : habitRows.length === 0 ? (
            <p className="caption">No habits scheduled for this day.</p>
          ) : (
            <ul className="event-list">
              {habitRows.map((h) => (
                <li key={h.task_id} className="flex items-center gap-3">
                  <input
                    id={`habit-${h.task_id}`}
                    type="checkbox"
                    checked={!!h.completed}
                    onChange={(e) => toggleHabit(h.task_id, e.target.checked)}
                  />
                  <label htmlFor={`habit-${h.task_id}`}>{h.activity_name}</label>
                  {h.completed && (
                    <span className="caption" style={{ marginLeft: "auto" }}>
                      ✓ completed
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
