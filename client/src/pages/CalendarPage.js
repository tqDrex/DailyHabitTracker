// src/pages/CalendarPage.jsx
import { useEffect, useMemo, useState, useCallback } from "react";
import { gapi } from "gapi-script";
import Calendar from "react-calendar";
import "react-calendar/dist/Calendar.css";
import Event from "../Components/Event.js";
import "../style/CalendarPage.css";

export default function CalendarPage() {
  // user from /api/me
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
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const isoDate = useMemo(() => date.toISOString().slice(0, 10), [date]); // YYYY-MM-DD

  // Create-event form
  const [newEventSummary, setNewEventSummary] = useState("");
  const [recurrenceFrequency, setRecurrenceFrequency] = useState("NONE");
  const [recurrenceCount, setRecurrenceCount] = useState(1);
  const [eventStartTime, setEventStartTime] = useState(
    today.toTimeString().slice(0, 5)
  );
  const [eventEndTime, setEventEndTime] = useState(
    new Date(today.getTime() + 60 * 60 * 1000).toTimeString().slice(0, 5)
  );

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
      } catch (err) {
        console.error("Failed to load user:", err);
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
        setError(
          "Failed to fetch events. Check your permissions and calendar ID."
        );
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
        u.searchParams.set("date", dateStr); // e.g., "2025-08-28"
        u.searchParams.set("userId", String(userId)); // until habits routes use req.user.id only

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

  // Toggle a habit’s completion for the selected date
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
              date: isoDate, // "YYYY-MM-DD" (user-local day you selected)
              completed: nextCompleted, // true = mark done, false = undo
              tz: tz || "UTC",
            }),
          }
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || "Failed to update habit completion");
        }

        // Try to read updated streak payload (our server may return { ok, streak })
        let payload = null;
        try {
          payload = await res.json();
        } catch {
          // ignore if server returned no json body
        }

        // Refresh this day's habit list
        await fetchHabitsForDate(isoDate);

        // 🔔 Notify other pages (e.g., Dashboard) that streaks changed
        window.dispatchEvent(
          new CustomEvent("streaks:changed", {
            detail: { taskId, date: isoDate, ...(payload || {}) },
          })
        );
      } catch (e) {
        console.error(e);
        setError(e.message);
      }
    },
    [userId, isoDate, tz, fetchHabitsForDate]
  );

  // ---------------- Create Google calendar event ----------------
  const handleCreateEvent = useCallback(
    async (e) => {
      e.preventDefault();
      if (
        !isGapiLoaded ||
        !hasGoogleToken ||
        !calendarId ||
        !newEventSummary
      ) {
        setError(
          "Cannot create event. Enter a name and ensure Google is linked."
        );
        return;
      }

      const startDate = new Date(date);
      const [sh, sm] = eventStartTime.split(":");
      startDate.setHours(parseInt(sh, 10), parseInt(sm, 10));

      const endDate = new Date(date);
      const [eh, em] = eventEndTime.split(":");
      endDate.setHours(parseInt(eh, 10), parseInt(em, 10));

      const event = {
        summary: newEventSummary.trim(),
        start: { dateTime: startDate.toISOString(), timeZone: tz },
        end: { dateTime: endDate.toISOString(), timeZone: tz },
      };
      if (recurrenceFrequency !== "NONE") {
        event.recurrence = [
          `RRULE:FREQ=${recurrenceFrequency};COUNT=${recurrenceCount}`,
        ];
      }

      try {
        await window.gapi.client.calendar.events.insert({
          calendarId,
          resource: event,
        });
        setNewEventSummary("");
        await getEvents(date);
      } catch (err) {
        console.error("Error adding event:", err);
        setError("Failed to add event. Please check your permissions.");
      }
    },
    [
      isGapiLoaded,
      hasGoogleToken,
      calendarId,
      newEventSummary,
      date,
      eventStartTime,
      eventEndTime,
      tz,
      recurrenceFrequency,
      recurrenceCount,
      getEvents,
    ]
  );

  const handleAddEvent = useCallback(
    async () => {
      if (!calendarId) return setError("Calendar ID not found.");
      if (!isGapiLoaded || !hasGoogleToken)
        return setError("Link Google and ensure API is ready.");

      const event = {
        summary: "New Test Event",
        start: { dateTime: new Date().toISOString(), timeZone: tz },
        end: {
          dateTime: new Date(Date.now() + 3600000).toISOString(),
          timeZone: tz,
        },
      };

      try {
        await window.gapi.client.calendar.events.insert({
          calendarId,
          resource: event,
        });
        await getEvents(date);
      } catch (err) {
        console.error("Error adding event:", err);
        setError("Failed to add event. Please check your permissions.");
      }
    },
    [calendarId, isGapiLoaded, hasGoogleToken, tz, getEvents, date]
  );

  // ---------------- Bootstrap Google client + calendar id (if linked) ----------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Google token lives under /api/auth/token
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

            // App calendar id lives under /api/calendar/id
            const calRes = await fetch("http://localhost:3000/api/calendar/id", {
              credentials: "include",
            });
            if (calRes.ok) {
              const data = await calRes.json();
              if (!cancelled) setCalendarID(data.calendarId);
            } else {
              if (!cancelled) setCalendarID(null);
            }
          }
        } else {
          // Not linked with Google; habits still work
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

  // React to date / calendar readiness
  useEffect(() => {
    if (calendarId && hasGoogleToken && isGapiLoaded) {
      getEvents(date);
    }
  }, [calendarId, hasGoogleToken, isGapiLoaded, date, getEvents]);

  // Habits refresh when the date or user changes
  useEffect(() => {
    if (userId) fetchHabitsForDate(isoDate);
  }, [isoDate, userId, fetchHabitsForDate]);

  if (booting || !user) return <div className="App py-8">Loading…</div>;

  return (
    <div className="App flex flex-col justify-center py-8 cp-stack">
      <h1 className="mb-4 text-2xl font-bold">Calendar Page</h1>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {/* Calendar card */}
      <div className="cp-card p-4">
        <p className="caption mb-2">
          {hasGoogleToken
            ? `Calendar ID: ${calendarId || "—"}`
            : "Google not linked — habits still available"}
        </p>
        <div className="flex flex-col items-center">
          <Calendar onChange={setDate} value={date} />
        </div>
      </div>

      {/* Habits */}
      <div className="cp-card p-4">
        <h2 className="text-xl font-bold mb-2">
          Habits for {date.toDateString()}
        </h2>
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

      {/* Google Events */}
      <div className="cp-card p-4">
        <h2 className="text-xl font-bold mb-2">
          Google Events on {date.toDateString()}
        </h2>
        {!hasGoogleToken ? (
          <p className="caption">
            Link Google on your dashboard to see calendar events here.
          </p>
        ) : events.length > 0 ? (
          <ul>
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
          <p className="mt-2 caption">No calendar events found for this day.</p>
        )}
      </div>

      {/* Create Event */}
      <div className="cp-card p-4">
        <h2 className="text-xl font-bold mb-4">Create New Event</h2>
        <form onSubmit={handleCreateEvent} className="create-event">
          <input
            type="text"
            value={newEventSummary}
            onChange={(e) => setNewEventSummary(e.target.value)}
            placeholder="Event Name"
            required
            disabled={!hasGoogleToken || !calendarId}
          />
          <div>
            <input
              type="time"
              value={eventStartTime}
              onChange={(e) => setEventStartTime(e.target.value)}
            />
            <input
              type="time"
              value={eventEndTime}
              onChange={(e) => setEventEndTime(e.target.value)}
            />
          </div>
          <select
            value={recurrenceFrequency}
            onChange={(e) => setRecurrenceFrequency(e.target.value)}
          >
            <option value="NONE">None</option>
            <option value="DAILY">Daily</option>
            <option value="WEEKLY">Weekly</option>
            <option value="MONTHLY">Monthly</option>
            <option value="YEARLY">Yearly</option>
          </select>
          {recurrenceFrequency !== "NONE" && (
            <input
              type="number"
              min="1"
              value={recurrenceCount}
              onChange={(e) =>
                setRecurrenceCount(Math.max(1, Number(e.target.value || 1)))
              }
            />
          )}
          <button
            type="submit"
            disabled={
              !isGapiLoaded || !hasGoogleToken || !calendarId || !newEventSummary
            }
          >
            Create Event
          </button>
          <button
            type="button"
            onClick={handleAddEvent}
            disabled={!isGapiLoaded || !hasGoogleToken || !calendarId}
          >
            Add New Test Event
          </button>
        </form>
      </div>
    </div>
  );
}
