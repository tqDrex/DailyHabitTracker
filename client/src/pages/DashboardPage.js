// src/pages/DashboardPage.jsx
import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import "../style/Dashboard.css";
import InsightsPanel from "../Components/InsightsPanel"; // ← donuts panel

const API = process.env.API_LINK;

/* ---------- Helpers ---------- */
function getUserIanaTz() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
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

/* ---------- Tiny UI helpers (no extra libs) ---------- */
function Sparkline({ points = [], height = 40, width = 160, max = 100 }) {
  if (!points.length) {
    return <div className="muted" style={{ height }}>{"No data"}</div>;
  }
  const stepX = width / Math.max(points.length - 1, 1);
  const clamp = (v) => Math.max(0, Math.min(max, Number(v) || 0));
  const path = points
    .map((v, i) => {
      const x = i * stepX;
      const y = height - (clamp(v) / max) * height;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Daily completion sparkline"
    >
      <path d={path} fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function Stat({ label, value, suffix = "" }) {
  return (
    <div className="stat">
      <div className="stat__value">
        {value}
        {suffix}
      </div>
      <div className="stat__label muted">{label}</div>
    </div>
  );
}

function Row({ left, right }) {
  return (
    <div className="row">
      <span className="row__left">{left}</span>
      <span className="row__right">{right}</span>
    </div>
  );
}

/* ---------- Dashboard ---------- */
export default function DashboardPage() {
  const [user, setUser] = useState(null);
  const [emailInput, setEmailInput] = useState("");
  const [emailError, setEmailError] = useState("");
  const [emailSuccess, setEmailSuccess] = useState("");
  const [currentStreaks, setCurrentStreaks] = useState([]);
  const [bestStreaks, setBestStreaks] = useState([]);
  const [dailyCompletion, setDailyCompletion] = useState([]);
  const [loadingStreaks, setLoadingStreaks] = useState(true);
  const [loadingCompletion, setLoadingCompletion] = useState(true);

  const navigate = useNavigate();
  const tz = getUserIanaTz();

  // Load session
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

  // Helper: refetch streaks (stable)
  const refetchStreaks = useCallback(
    async (signal) => {
      if (!user?.id) return;
      const [curRes, bestRes] = await Promise.all([
        fetch(
          `${API}/streaks/current?userId=${user.id}&tz=${encodeURIComponent(
            tz
          )}`,
          { credentials: "include", signal }
        ),
        fetch(`${API}/streaks/best?userId=${user.id}`, {
          credentials: "include",
          signal,
        }),
      ]);
      const [curRows, bestRows] = await Promise.all([
        curRes.json(),
        bestRes.json(),
      ]);
      (curRows || []).sort(
        (a, b) =>
          Number(b.current_streak_days || 0) - Number(a.current_streak_days || 0)
      );
      (bestRows || []).sort(
        (a, b) => Number(b.best_streak_days || 0) - Number(a.best_streak_days || 0)
      );
      setCurrentStreaks(curRows || []);
      setBestStreaks(bestRows || []);
    },
    [user?.id, tz]
  );

  // Helper: refetch completion series (stable)
  const refetchCompletion = useCallback(
    async (signal) => {
      if (!user?.id) return;
      const res = await fetch(
        `${API}/stats/completion/daily?userId=${user.id}&tz=${encodeURIComponent(
          tz
        )}`,
        { credentials: "include", signal }
      );
      const rows = await res.json().catch(() => []);
      const safe = Array.isArray(rows) ? rows.slice() : [];
      safe.sort((a, b) => {
        const da = new Date(a.day || a.date || 0).getTime();
        const db = new Date(b.day || b.date || 0).getTime();
        return da - db;
      });
      setDailyCompletion(safe);
    },
    [user?.id, tz]
  );

  // Load on mount/user change
  useEffect(() => {
    if (!user?.id) return;
    const ac = new AbortController();
    (async () => {
      try {
        setLoadingStreaks(true);
        setLoadingCompletion(true);
        await Promise.all([
          refetchStreaks(ac.signal),
          refetchCompletion(ac.signal),
        ]);
      } finally {
        if (!ac.signal.aborted) {
          setLoadingStreaks(false);
          setLoadingCompletion(false);
        }
      }
    })();
    return () => ac.abort();
  }, [user?.id, tz, refetchStreaks, refetchCompletion]);

  // Listen for “streaks:changed” and refetch
  useEffect(() => {
    if (!user?.id) return;
    const onChanged = async () => {
      try {
        await refetchStreaks();
        await refetchCompletion();
        // Also refresh donuts if InsightsPanel is listening (optional custom event)
        window.dispatchEvent(new CustomEvent("progress:added"));
      } catch {}
    };
    window.addEventListener("streaks:changed", onChanged);
    return () => window.removeEventListener("streaks:changed", onChanged);
  }, [user?.id, tz, refetchStreaks, refetchCompletion]);

  const handleLogout = async () => {
    try {
      await fetch(`${API}/logout`, {
        method: "POST",
        credentials: "include",
      });
    } finally {
      window.location.href = "/";
    }
  };

  const handleEmailLink = async () => {
    setEmailError("");
    setEmailSuccess("");
    if (!emailInput.trim() || !/^\S+@\S+\.\S+$/.test(emailInput)) {
      setEmailError("Please enter a valid email address.");
      return;
    }

    try {
      const res = await fetch(`${API}/api/link-email`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailInput }),
      });

      if (res.ok) {
        setUser((prev) => ({ ...prev, email: emailInput }));
        setEmailSuccess("Email linked successfully.");
      } else if (res.status === 409) {
        setEmailError("This email is already linked to another account.");
      } else {
        setEmailError("Unable to link email. Please try again.");
      }
    } catch {
      setEmailError("Network error. Please try again.");
    }
  };

  // Derived stats
  const todayStats = useMemo(() => {
    if (!dailyCompletion.length) return { total: 0, done: 0, pct: 0 };
    const last = dailyCompletion[dailyCompletion.length - 1] || {};
    return {
      total: Number(last.total || 0),
      done: Number(last.done || 0),
      pct: Number(last.pct_done || 0),
    };
  }, [dailyCompletion]);

  const pctSeries = useMemo(
    () => dailyCompletion.map((d) => Number(d.pct_done || 0)),
    [dailyCompletion]
  );

  const displayBest = useMemo(() => {
    return (bestStreaks || [])
      .filter((r) => Number(r.best_streak_days || 0) > 0)
      .sort(
        (a, b) =>
          Number(b.best_streak_days || 0) - Number(a.best_streak_days || 0)
      );
  }, [bestStreaks]);

  const displayCurrent = useMemo(() => {
    return (currentStreaks || [])
      .filter((r) => Number(r.current_streak_days || 0) > 0)
      .sort(
        (a, b) =>
          Number(b.current_streak_days || 0) - Number(a.current_streak_days || 0)
      );
  }, [currentStreaks]);

  if (!user) return <p>Loading...</p>;

  return (
    <div className="dashboard">
      <div className="dashboard__topbar">
        <div className="dashboard__brand">Daily Habit Tracker</div>

        <nav className="dashboard__nav">
          <NavButton to="/dashboard">Dashboard</NavButton>
          <NavButton to="/todo">To-Do</NavButton>
          <NavButton to="/calendar">Calendar</NavButton>
          <NavButton to="/test">Calendar</NavButton>
          <NavButton to="/study">Study Session Planner</NavButton>

        </nav>

        <div className="dashboard__actions">
          {user.mustChangePassword && (
            <button
              className="btn btn--warning"
              onClick={() => navigate("/change-password")}
              title="You must set a permanent password"
            >
              Change Password
            </button>
          )}
          <button className="btn btn--danger" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </div>

      <div className="dashboard__container">
        {user.mustChangePassword && (
          <div className="card card--warn mt-0">
            <p className="muted mt-0">
              First time here? A temporary password was emailed to you. Please
              change it now.
            </p>
          </div>
        )}

        {!user.email && (
          <div className="card card--info">
            <h3>Link Your Email</h3>
            <p className="muted">
              We recommend linking an email for password recovery and
              notifications.
            </p>
            <input
              type="email"
              placeholder="Enter your email"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              className="input"
            />
            <button className="btn btn--primary mt-8" onClick={handleEmailLink}>
              Link Email
            </button>
            {emailError && <p style={{ color: "crimson" }}>{emailError}</p>}
            {emailSuccess && <p style={{ color: "green" }}>{emailSuccess}</p>}
          </div>
        )}

        <div className="card">
          <div className="card__header">
            {user.avatarUrl && (
              <img className="avatar" src={user.avatarUrl} alt="Avatar" />
            )}
            <div>
              <h1 className="h1-tight">
                Welcome, {user.name ?? user.username}!
              </h1>
              <p className="muted">Email: {user.email ?? "—"}</p>
            </div>
          </div>

          <div className="grid grid--2">
            {/* ---------- Today Summary ---------- */}
            <div className="card">
              <h3>Today</h3>
              <p className="muted">Quick snapshot of your day.</p>

              <div className="stats">
                <Stat label="Completed Today" value={todayStats.done} />
                <Stat label="Scheduled Today" value={todayStats.total} />
                <Stat label="Completion" value={todayStats.pct} suffix="%" />
              </div>

              <div className="muted mt-8">Last 14 days completion</div>
              <div className="sparkline">
                {loadingCompletion ? (
                  <span className="muted">Loading…</span>
                ) : (
                  <Sparkline points={pctSeries} />
                )}
              </div>
            </div>

            {/* ---------- Streaks ---------- */}
            <div className="card">
              <h3>Streaks</h3>
              {loadingStreaks ? (
                <p className="muted">Loading streaks…</p>
              ) : (
                <>
                  <div className="grid grid--2">
                    <div className="card p-12">
                      <h4 className="mt-0">Current 🔥</h4>
                      {displayCurrent.length === 0 ? (
                        <p className="muted">
                          No streaks yet. Complete a habit today to start one!
                        </p>
                      ) : (
                        <div className="list">
                          {displayCurrent.slice(0, 6).map((r) => (
                            <Row
                              key={`cur-${r.task_id}`}
                              left={<span className="truncate">{r.activity_name}</span>}
                              right={<span className="badge">{Number(r.current_streak_days || 0)}d</span>}
                            />
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="card p-12">
                      <h4 className="mt-0">Best 🏆</h4>
                      {displayBest.length === 0 ? (
                        <p className="muted">No history yet.</p>
                      ) : (
                        <div className="list">
                          {displayBest.slice(0, 6).map((r) => (
                            <Row
                              key={`best-${r.task_id}`}
                              left={<span className="truncate">{r.activity_name}</span>}
                              right={<span className="badge">{Number(r.best_streak_days || 0)}d</span>}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <p className="muted mt-8">
                    Streaks grow when you complete a habit on every scheduled
                    day.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ---------- NEW: Insights donuts (daily/weekly/monthly) ---------- */}
        <InsightsPanel defaultWindow="daily" />
      </div>
    </div>
  );
}
