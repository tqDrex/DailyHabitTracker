// src/pages/ToDoPage.js
import React, { useEffect, useMemo, useState } from "react";
import { gapi } from "gapi-script";
import { useNavigate, useLocation } from "react-router-dom";
import "../style/ToDoPage.css";

const API = "http://localhost:3000";

/* ---------- helpers ---------- */

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

function isoDateOnly(d) {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
    .toISOString()
    .slice(0, 10);
}
function todayLocalAtMidnight() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

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

/* ---------- tiny UI atoms ---------- */

function ProgressBar({ value = 0, max = 100 }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="mini-progress">
      <div className="mini-progress__fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

function ChipButton({ children, onClick, disabled }) {
  return (
    <button className="chip-btn" onClick={onClick} disabled={disabled} type="button">
      {children}
    </button>
  );
}

/* ===================================================================== */

export default function ToDoPage() {
  const [user, setUser] = useState(null);

  // tasks
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  // create modal state
  const [showModal, setShowModal] = useState(false);
  const [activityName, setActivityName] = useState("");
  const [useTimer, setUseTimer] = useState(false);
  const [minutes, setMinutes] = useState("");
  const [useCounter, setUseCounter] = useState(false);
  const [times, setTimes] = useState("");
  const [deadline, setDeadline] = useState("");
  const [repeat, setRepeat] = useState("none");

  // calendar bootstrap
  const [isGapiLoaded, setIsGapiLoaded] = useState(false);
  const [hasGoogleToken, setHasGoogleToken] = useState(false);
  const [calendarId, setCalendarID] = useState(null);

  // per-task progress cache { [taskId]: { minutes, count } }
  const [progressByTask, setProgressByTask] = useState({});

  const userTz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  /* ---------- auth ---------- */
  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        const res = await fetch(`${API}/api/me`, {
          credentials: "include",
          signal: ac.signal,
        });
        if (!res.ok) throw new Error("Not logged in");
        const me = await res.json();
        if (!ac.signal.aborted) setUser(me);
      } catch {
        if (!ac.signal.aborted) window.location.href = "/";
      }
    })();
    return () => ac.abort();
  }, []);

  /* ---------- tasks load ---------- */
  const fetchTasks = async (signal) => {
    const res = await fetch(`${API}/tasks`, { credentials: "include", signal });
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
        setErr(null);
        const tasks = await fetchTasks(ac.signal);
        if (ac.signal.aborted) return;
        setRows(tasks);

        // Best-effort: hydrate progress totals per task
        const entries = await Promise.all(
          tasks.map(async (t) => {
            try {
              const r = await fetch(`${API}/tasks/${t.id}/progress/summary`, {
                credentials: "include",
                signal: ac.signal,
              });
              if (!r.ok) throw new Error();
              const j = await r.json();
              return [t.id, { minutes: Number(j.minutes || 0), count: Number(j.count || 0) }];
            } catch {
              return [t.id, { minutes: 0, count: 0 }];
            }
          })
        );
        if (!ac.signal.aborted) {
          setProgressByTask(Object.fromEntries(entries));
        }
      } catch (e) {
        if (!ac.signal.aborted) {
          setRows([]);
          setProgressByTask({});
          setErr(e.message || "Failed to load tasks");
        }
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    })();
    return () => ac.abort();
  }, [user]);

  /* ---------- Google bootstrap (optional) ---------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const tokenRes = await fetch(`${API}/api/auth/token`, {
          credentials: "include",
        });
        if (!tokenRes.ok) return setHasGoogleToken(false);
        const tokenData = await tokenRes.json();
        if (!tokenData?.accessToken) return setHasGoogleToken(false);

        await new Promise((resolve) => gapi.load("client:auth2", resolve));
        await window.gapi.client.load("calendar", "v3");
        if (cancelled) return;

        setIsGapiLoaded(true);
        gapi.auth.setToken({ access_token: tokenData.accessToken });
        setHasGoogleToken(true);

        const calRes = await fetch(`${API}/api/calendar/id`, {
          credentials: "include",
        });
        if (calRes.ok) {
          const data = await calRes.json();
          if (!cancelled) setCalendarID(data.calendarId || null);
        } else if (!cancelled) setCalendarID(null);
      } catch {
        setHasGoogleToken(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /* ---------- calendar event on create ---------- */
  async function createCalendarEventForTask({ activityName, deadline, repeat }) {
    try {
      if (!isGapiLoaded || !hasGoogleToken || !calendarId) return;
      if (!deadline) return;

      const start = todayLocalAtMidnight();
      const dl = new Date(deadline);
      dl.setHours(0, 0, 0, 0);
      if (dl.getTime() < start.getTime()) return;

      if (repeat && repeat !== "none") {
        const until = new Date(dl);
        until.setHours(23, 59, 59, 999);
        const untilStr =
          until.toISOString().replace(/[-:]/g, "").replace(".000", "").slice(0, 15) + "Z";

        const resource = {
          summary: activityName,
          description: "Auto-created from Daily Habit Tracker task",
          start: { date: isoDateOnly(start) },
          end: { date: isoDateOnly(new Date(start.getTime() + 86400000)) },
          recurrence: [`RRULE:FREQ=${repeat.toUpperCase()};UNTIL=${untilStr}`],
        };
        await window.gapi.client.calendar.events.insert({ calendarId, resource });
      } else {
        const endExclusive = new Date(dl);
        endExclusive.setDate(endExclusive.getDate() + 1);
        const resource = {
          summary: activityName,
          description: "Auto-created from Daily Habit Tracker task",
          start: { date: isoDateOnly(start) },
          end: { date: isoDateOnly(endExclusive) },
        };
        await window.gapi.client.calendar.events.insert({ calendarId, resource });
      }
    } catch (e) {
      console.warn("Calendar insert failed:", e);
    }
  }

  /* ---------- create task ---------- */
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
      deadline: deadline || null,
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

      await createCalendarEventForTask({
        activityName: payload.activityName,
        deadline: payload.deadline,
        repeat: payload.repeat,
      });

      setShowModal(false);
      setActivityName("");
      setUseTimer(false);
      setMinutes("");
      setUseCounter(false);
      setTimes("");
      setDeadline("");
      setRepeat("none");

      const tasks = await fetchTasks();
      setRows(tasks);
      // init progress 0 for any new tasks to avoid undefined
      setProgressByTask((prev) => {
        const next = { ...prev };
        tasks.forEach((t) => {
          if (!next[t.id]) next[t.id] = { minutes: 0, count: 0 };
        });
        return next;
      });
    } catch (e) {
      console.error(e);
      setErr(e.message || "Failed to save task");
    }
  };

  /* ---------- add progress ---------- */
  async function addProgress(task, type, value) {
    try {
      if (!value || value <= 0) return;
      const res = await fetch(`${API}/tasks/${task.id}/progress`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,                // 'minutes' | 'count'
          value,               // positive integer
          at: new Date().toISOString(),
          tz: userTz,          // ✅ include tz so streaks update on server
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || "Failed to add progress");
      }

      // Refresh the server-authoritative totals (and reflect any streak effects)
      const sumRes = await fetch(`${API}/tasks/${task.id}/progress/summary`, {
        credentials: "include",
      });
      if (sumRes.ok) {
        const totals = await sumRes.json();
        setProgressByTask((prev) => ({
          ...prev,
          [task.id]: {
            minutes: Number(totals.minutes || 0),
            count: Number(totals.count || 0),
          },
        }));
      } else {
        // fallback optimistic update if summary fetch failed
        setProgressByTask((prev) => {
          const cur = prev[task.id] || { minutes: 0, count: 0 };
          return {
            ...prev,
            [task.id]: {
              minutes: type === "minutes" ? cur.minutes + value : cur.minutes,
              count: type === "count" ? cur.count + value : cur.count,
            },
          };
        });
      }

      // Let other tabs (e.g., Dashboard) know streaks might have changed
      window.dispatchEvent(new CustomEvent("streaks:changed", { detail: { taskId: task.id } }));
    } catch (e) {
      console.error(e);
      setErr(e.message || "Failed to add progress");
    }
  }

  const empty = useMemo(() => !loading && rows.length === 0, [loading, rows]);

  if (loading) return <p>Loading tasks…</p>;

  return (
    <div className="dashboard">
      <div className="dashboard__topbar">
        <div className="dashboard__brand">Daily Habit Tracker</div>

        <nav className="dashboard__nav">
          <NavButton to="/dashboard">Dashboard</NavButton>
          <NavButton to="/todo">To-Do</NavButton>
          <NavButton to="/calendar">Calendar</NavButton>
        </nav>
      </div>

      <div className="todo-container">
        <h1>To-Do Page</h1>

        {err && (
          <div className="error-banner" role="alert">
            {err}
          </div>
        )}

        <div className="flex-center">
          <table className="todo-table">
            <thead>
              <tr>
                <th>Activity</th>
                <th>Timer</th>
                <th>Counter</th>
                <th>Deadline</th>
                <th>Repeat</th>
                <th style={{ width: 320 }}>Make Progress</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const prog = progressByTask[row.id] || { minutes: 0, count: 0 };
                const timerGoal = row.timer ?? null;
                const counterGoal = row.counter ?? null;

                return (
                  <tr key={row.id}>
                    <td data-label="Activity">{row.activityName}</td>

                    {/* Timer cell with progress */}
                    <td data-label="Timer">
                      {timerGoal ? (
                        <div>
                          <div className="muted small">
                            {prog.minutes}/{timerGoal} min
                          </div>
                          <ProgressBar value={prog.minutes} max={timerGoal} />
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>

                    {/* Counter cell with progress */}
                    <td data-label="Counter">
                      {counterGoal ? (
                        <div>
                          <div className="muted small">
                            {prog.count}/{counterGoal}
                          </div>
                          <ProgressBar value={prog.count} max={counterGoal} />
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>

                    <td data-label="Deadline">
                      {row.deadlineDate
                        ? new Date(row.deadlineDate).toLocaleDateString()
                        : "—"}
                    </td>
                    <td data-label="Repeat">{row.repeat ?? "—"}</td>

                    {/* Quick-add controls */}
                    <td className="progress-actions">
                      {timerGoal && (
                        <div className="stack">
                          <div className="muted small">Add minutes</div>
                          <div className="chip-row">
                            <ChipButton onClick={() => addProgress(row, "minutes", 5)}>+5</ChipButton>
                            <ChipButton onClick={() => addProgress(row, "minutes", 15)}>+15</ChipButton>
                            <ChipButton onClick={() => addProgress(row, "minutes", 25)}>+25</ChipButton>
                            <input
                              type="number"
                              min="1"
                              placeholder="+min"
                              className="chip-input"
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  const v = Number(e.currentTarget.value || 0);
                                  if (v > 0) addProgress(row, "minutes", v);
                                  e.currentTarget.value = "";
                                }
                              }}
                            />
                          </div>
                        </div>
                      )}

                      {counterGoal && (
                        <div className="stack mt-8">
                          <div className="muted small">Add count</div>
                          <div className="chip-row">
                            <ChipButton onClick={() => addProgress(row, "count", 1)}>+1</ChipButton>
                            <ChipButton onClick={() => addProgress(row, "count", 5)}>+5</ChipButton>
                            <input
                              type="number"
                              min="1"
                              placeholder="+count"
                              className="chip-input"
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  const v = Number(e.currentTarget.value || 0);
                                  if (v > 0) addProgress(row, "count", v);
                                  e.currentTarget.value = "";
                                }
                              }}
                            />
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {empty && (
                <tr>
                  <td colSpan="6" style={{ textAlign: "center", color: "#666" }}>
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
                  {/* Activity */}
                  <label className="field-label" htmlFor="task-name">Activity Name</label>
                  <input
                    id="task-name"
                    type="text"
                    placeholder="e.g., Read a book"
                    value={activityName}
                    onChange={(e) => setActivityName(e.target.value)}
                    className="input"
                    required
                  />

                  <hr className="divider" />

                  {/* Timer */}
                  <div className={`row ${useTimer ? "on" : ""}`}>
                    <input
                      type="checkbox"
                      checked={useTimer}
                      onChange={(e) => setUseTimer(e.target.checked)}
                      id="timerChk"
                    />
                    <label htmlFor="timerChk">Timer goal (minutes)</label>
                  </div>
                  {useTimer && (
                    <div className="inline-extra">
                      <label className="field-label sm" htmlFor="minutes">Minutes</label>
                      <input
                        id="minutes"
                        type="number"
                        min="1"
                        placeholder="e.g., 360"
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
                    <label htmlFor="counterChk">Counter goal (times)</label>
                  </div>
                  {useCounter && (
                    <div className="inline-extra">
                      <label className="field-label sm" htmlFor="times">Times</label>
                      <input
                        id="times"
                        type="number"
                        min="1"
                        placeholder="e.g., 20"
                        value={times}
                        onChange={(e) => setTimes(e.target.value)}
                        className="input"
                        required
                      />
                    </div>
                  )}

                  <hr className="divider" />

                  {/* Deadline */}
                  <label className="field-label" htmlFor="deadline">Deadline</label>
                  <input
                    id="deadline"
                    type="date"
                    value={deadline}
                    onChange={(e) => setDeadline(e.target.value)}
                    className="input"
                  />

                  {/* Repeat */}
                  <label className="field-label" htmlFor="repeat">Repeat</label>
                  <select
                    id="repeat"
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
    </div>
  );
}
