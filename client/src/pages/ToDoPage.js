import React, { useEffect, useMemo, useState } from "react";
import { gapi } from "gapi-script";
import "../style/ToDoPage.css";

const API = "http://localhost:3000";

// normalize API rows (snake_case or camelCase)
function normalizeTask(r) {
  return {
    id: r.id,
    activityName: r.activityName ?? r.activity_name ?? "",
    timer: r.timer ?? null,
    counter: r.counter ?? null,
    deadlineDate: r.deadlineDate ?? r.deadline_date ?? null,
    repeat: r.repeat ?? null,
  };
}

// date helpers
function isoDateOnly(d) {
  // returns YYYY-MM-DD from a Date
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
    .toISOString()
    .slice(0, 10);
}
function todayLocalAtMidnight() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export default function ToDoPage() {
  const [user, setUser] = useState(null);
  const [rows, setRows] = useState([]);
  const [activityName, setActivityName] = useState("");
  const [useTimer, setUseTimer] = useState(false);
  const [minutes, setMinutes] = useState("");
  const [useCounter, setUseCounter] = useState(false);
  const [times, setTimes] = useState("");
  const [deadline, setDeadline] = useState("");
  const [repeat, setRepeat] = useState("none");
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  // Google calendar bootstrap (client-side, like CalendarPage)
  const [isGapiLoaded, setIsGapiLoaded] = useState(false);
  const [hasGoogleToken, setHasGoogleToken] = useState(false);
  const [calendarId, setCalendarID] = useState(null);

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  // Load session/user
  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        const res = await fetch(`${API}/api/me`, {
          credentials: "include",
          signal: ac.signal,
        });
        if (!res.ok) throw new Error("Not logged in");
        const data = await res.json();
        if (!ac.signal.aborted) setUser(data);
      } catch {
        if (!ac.signal.aborted) window.location.href = "/";
      }
    })();
    return () => ac.abort();
  }, []);

  // Fetch tasks
  const fetchTasks = async (signal) => {
    setErr(null);
    const res = await fetch(`${API}/tasks`, {
      credentials: "include",
      signal,
    });
    if (!res.ok) throw new Error("Task load failed");
    const body = await res.json();
    const list = Array.isArray(body) ? body : body.rows || [];
    return list.map(normalizeTask);
  };

  useEffect(() => {
    if (!user) return;
    const ac = new AbortController();
    (async () => {
      try {
        setLoading(true);
        const tasks = await fetchTasks(ac.signal);
        if (!ac.signal.aborted) setRows(tasks);
      } catch (e) {
        if (!ac.signal.aborted) {
          setRows([]);
          setErr(e.message || "Failed to load tasks");
        }
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    })();
    return () => ac.abort();
  }, [user]);

  // ---------- Google bootstrap (optional; skip if not linked) ----------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const tokenRes = await fetch(`${API}/api/auth/token`, {
          credentials: "include",
        });
        if (!tokenRes.ok) {
          setHasGoogleToken(false);
          return;
        }
        const tokenData = await tokenRes.json();
        if (!tokenData?.accessToken) {
          setHasGoogleToken(false);
          return;
        }
        await new Promise((resolve) => gapi.load("client:auth2", resolve));
        await window.gapi.client.load("calendar", "v3");
        if (cancelled) return;
        setIsGapiLoaded(true);
        gapi.auth.setToken({ access_token: tokenData.accessToken });
        setHasGoogleToken(true);

        // get the app's calendar id
        const calRes = await fetch(`${API}/api/calendar/id`, {
          credentials: "include",
        });
        if (calRes.ok) {
          const data = await calRes.json();
          if (!cancelled) setCalendarID(data.calendarId || null);
        } else if (!cancelled) {
          setCalendarID(null);
        }
      } catch {
        // Calendar is optional for ToDo; ignore bootstrap errors
        setHasGoogleToken(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---------- Create a calendar event for a new task ----------
  async function createCalendarEventForTask({ activityName, deadline, repeat }) {
    try {
      if (!isGapiLoaded || !hasGoogleToken || !calendarId) return;
      if (!deadline) return; // only create when a deadline exists

      const start = todayLocalAtMidnight();
      const dl = new Date(deadline); // yyyy-mm-dd -> local
      dl.setHours(0, 0, 0, 0);

      // if deadline is before today, do nothing
      if (dl.getTime() < start.getTime()) return;

      // If task repeats => recurring event starting today until the deadline.
      if (repeat && repeat !== "none") {
        // All-day recurring event. Google UNTIL is in UTC in the form YYYYMMDDT235959Z
        const until = new Date(dl);
        until.setHours(23, 59, 59, 999);
        const untilStr = until
          .toISOString()
          .replace(/[-:]/g, "")
          .replace(".000", "")
          .slice(0, 15) + "Z"; // e.g., 20250829T235959Z

        const resource = {
          summary: activityName,
          description: "Auto-created from Daily Habit Tracker task",
          start: { date: isoDateOnly(start) },                     // all-day
          end: { date: isoDateOnly(new Date(start.getTime() + 86400000)) }, // end is exclusive for all-day
          recurrence: [`RRULE:FREQ=${repeat.toUpperCase()};UNTIL=${untilStr}`],
        };

        await window.gapi.client.calendar.events.insert({
          calendarId,
          resource,
        });
      } else {
        // Non-repeating task => one multi-day all-day event spanning today..deadline (inclusive)
        const endExclusive = new Date(dl);
        endExclusive.setDate(endExclusive.getDate() + 1);

        const resource = {
          summary: activityName,
          description: "Auto-created from Daily Habit Tracker task",
          start: { date: isoDateOnly(start) },            // all-day
          end: { date: isoDateOnly(endExclusive) },       // exclusive
        };

        await window.gapi.client.calendar.events.insert({
          calendarId,
          resource,
        });
      }
    } catch (e) {
      // Don’t block task creation if calendar insert fails
      console.warn("Calendar insert failed:", e);
    }
  }

  // Create new task
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!useTimer && !useCounter) {
      alert("Please select at least Timer or Counter.");
      return;
    }

    const payload = {
      activityName,
      timer: useTimer ? Number(minutes) : null,
      counter: useCounter ? Number(times) : null,
      deadline: deadline || null,              // expects YYYY-MM-DD
      repeat: repeat !== "none" ? repeat : null,
    };

    try {
      setErr(null);
      const res = await fetch(`${API}/tasks/createTask`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        throw new Error(msg || "Failed to save task");
      }

      // Try to add a calendar event that spans today..deadline (or recurring until deadline)
      await createCalendarEventForTask({
        activityName: payload.activityName,
        deadline: payload.deadline,
        repeat: payload.repeat,
      });

      // Reset form
      setShowModal(false);
      setActivityName("");
      setUseTimer(false);
      setMinutes("");
      setUseCounter(false);
      setTimes("");
      setDeadline("");
      setRepeat("none");

      // Refresh task list
      const tasks = await fetchTasks();
      setRows(tasks);
    } catch (e) {
      console.error(e);
      setErr(e.message || "Failed to save task");
    }
  };

  const empty = useMemo(() => !loading && rows.length === 0, [loading, rows]);

  if (loading) return <p>Loading tasks…</p>;

  return (
    <div className="todo-container">
      <h1>To-Do Page</h1>
      <div className="nav-buttons">
        <button
          className="btn secondary nav-btn"
          onClick={() => (window.location.href = "/dashboard")}
        >
          ⬅ Back to Dashboard
        </button>
      </div>

      {err && (
        <div className="error-banner" role="alert">
          {err}
        </div>
      )}

      <div className="flex-center">
        <table className="todo-table">
          <thead>
            <tr>
              <th>Activity Name</th>
              <th>Timer (min)</th>
              <th>Counter</th>
              <th>Deadline Date</th>
              <th>Repeat</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td data-label="Activity Name">{row.activityName}</td>
                <td data-label="Timer (min)">{row.timer ?? ""}</td>
                <td data-label="Counter">{row.counter ?? ""}</td>
                <td data-label="Deadline Date">
                  {row.deadlineDate
                    ? new Date(row.deadlineDate).toLocaleDateString()
                    : ""}
                </td>
                <td data-label="Repeat">{row.repeat ?? ""}</td>
              </tr>
            ))}
            {empty && (
              <tr>
                <td colSpan="5" style={{ textAlign: "center", color: "#666" }}>
                  No tasks yet. Click the + to add one.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <button
          className="circle-btn"
          onClick={() => setShowModal(true)}
          aria-label="Add"
        >
          +
        </button>

        {showModal && (
          <div className="modal-backdrop" onClick={() => setShowModal(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h2 className="modal-title">Create Task</h2>

              <form onSubmit={handleSubmit} className="modal-form">
                <input
                  type="text"
                  placeholder="Activity Name"
                  value={activityName}
                  onChange={(e) => setActivityName(e.target.value)}
                  className="input"
                  required
                />

                {/* Timer */}
                <div className={`row ${useTimer ? "on" : ""}`}>
                  <input
                    type="checkbox"
                    checked={useTimer}
                    onChange={(e) => setUseTimer(e.target.checked)}
                    id="timerChk"
                  />
                  <label htmlFor="timerChk">Timer</label>
                </div>
                {useTimer && (
                  <div className="inline-extra">
                    <input
                      type="number"
                      min="1"
                      placeholder="Minutes"
                      value={minutes}
                      onChange={(e) => setMinutes(e.target.value)}
                      className="input"
                      required
                    />
                  </div>
                )}

                {/* Counter */}
                <div className={`row ${useCounter ? "on" : ""}`}>
                  <input
                    type="checkbox"
                    checked={useCounter}
                    onChange={(e) => setUseCounter(e.target.checked)}
                    id="counterChk"
                  />
                  <label htmlFor="counterChk">Counter</label>
                </div>
                {useCounter && (
                  <div className="inline-extra">
                    <input
                      type="number"
                      min="1"
                      placeholder="Times"
                      value={times}
                      onChange={(e) => setTimes(e.target.value)}
                      className="input"
                      required
                    />
                  </div>
                )}

                <input
                  type="date"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                  className="input"
                />

                <select
                  value={repeat}
                  onChange={(e) => setRepeat(e.target.value)}
                  className="input"
                >
                  <option value="none">None</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>

                <div className="row end">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="btn secondary"
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn primary">
                    Save
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
