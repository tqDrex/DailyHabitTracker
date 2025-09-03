// src/pages/CalendarPage.jsx
import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { gapi } from "gapi-script";
import Calendar from "react-calendar";
import "react-calendar/dist/Calendar.css";
import Event from "../Components/Event.js";
import "../style/CalendarPage.css";

/* ---------- Nav button ---------- */
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

/* ---------- Date helpers ---------- */
function safeTz() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
const ONE_DAY = 24 * 3600 * 1000;
function startOfDayLocal(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function startOfISOWeekUTC(d) {
  /*
  const u = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  );
  //const dow = (u.getUTCDay() + 6) % 7;
  const dow = u.getUTCDay();
  u.setUTCDate(u.getUTCDate() - dow);
  return u;
  */
  const date = new Date(d.getTime());
  const day = date.getUTCDay();
  const diff = date.getUTCDate() - day;
  date.setUTCDate(diff);
  return date;
}
function monthStartUTC(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function addMonthsUTC(d, n) {
  const x = monthStartUTC(d);
  x.setUTCMonth(x.getUTCMonth() + n);
  return x;
}
function yearStartUTC(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
}
function addYearsUTC(d, n) {
  const x = yearStartUTC(d);
  x.setUTCFullYear(x.getUTCFullYear() + n);
  return x;
}
function fmtDay(d) {
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
function fmtMonth(d) {
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}
function fmtYear(d) {
  return d.toLocaleDateString(undefined, {year: "numeric"});
}

function computePeriod(window, offset) {
  const now = new Date();
  if (window === "daily") {
    const start = startOfDayLocal(addDays(now, offset));
    const end = addDays(start, 1);
    return { start, end, label: fmtDay(start) };
  }
  if (window === "weekly") {
    const base = startOfISOWeekUTC(new Date());
    base.setUTCDate(base.getUTCDate() + offset * 7);
    const start = new Date(base),
      end = addDays(start, 7);
    const endLabel = addDays(start, 6);
    return {
      start,
      end,
      label: `Week of ${fmtDay(start)} – ${fmtDay(endLabel)}`,
    };
  }
  if (window === "monthly") {
    const first = addMonthsUTC(new Date(), offset);
    const next = addMonthsUTC(first, 1);
    return { start: first, end: next, label: fmtMonth(addMonthsUTC(first, 1)) };
  }
  const y0 = new Date(now.getFullYear() + offset - 1, 0, 1);
  const y1 = new Date(now.getFullYear() + offset, 0, 1);
  return { start: y0, end: y1, label: fmtYear(addYearsUTC(y0, 1)) };
}

/* ---------- Rule helpers ---------- */
function parseMaybeDate(x) {
  if (!x) return null;
  const d = new Date(x);
  return isNaN(d) ? null : d;
}
function repeatMatchesMode(rep, mode) {
  const r = (rep || "").toLowerCase();
  if (mode === "daily") return !r || r === "daily";
  if (mode === "weekly") return r === "weekly";
  if (mode === "monthly") return r === "monthly";
  if (mode === "yearly") return r === "yearly";
  return false;
}
/** Clamp [start,end) by “no before today” + “no after deadline” */
function clampByRules(period, row) {
  const today = startOfDayLocal(new Date());
  const deadline =
    row.deadline_date || row.deadlineDate
      ? startOfDayLocal(new Date(row.deadline_date || row.deadlineDate))
      : null;

  const start = new Date(Math.max(period.start.getTime(), today.getTime()));
  let end = new Date(period.end);
  if (deadline) {
    const deadlineEnd = new Date(deadline.getTime() + ONE_DAY);
    end = new Date(Math.min(end.getTime(), deadlineEnd.getTime()));
  }
  if (end <= start) return null;
  return { start, end };
}
/** True if row has any occurrence in window and repeat matches */
function taskVisibleInPeriodForMode(row, period, mode) {
  if (!repeatMatchesMode(row.repeat || row.task_repeat, mode)) return false;
  const p = clampByRules(period, row);
  if (!p) return false;

  const rep = (row.repeat || row.task_repeat || "").toLowerCase();
  // Non-repeating: only shown for its deadline day in Daily
  if (!rep) {
    if (mode !== "daily") return false;
    const d = parseMaybeDate(row.deadline_date || row.deadlineDate);
    if (!d) return false;
    const day = startOfDayLocal(d);
    return day >= p.start && day < p.end;
  }
  if (rep === "daily") return p.end > p.start;

  if (rep === "weekly") {
    const anchorDow = startOfDayLocal(new Date()).getDay();
    for (let t = new Date(p.start); t < p.end; t = addDays(t, 1))
      if (t.getDay() === anchorDow) return true;
    return false;
  }
  if (rep === "monthly") {
    const ref = parseMaybeDate(row.deadline_date || row.deadlineDate) || new Date();
    const dom = startOfDayLocal(ref).getDate();
    for (let t = new Date(p.start); t < p.end; t = addDays(t, 1))
      if (t.getDate() === dom) return true;
    return false;
  }
  if (rep === "yearly") {
    const ref = parseMaybeDate(row.deadline_date || row.deadlineDate) || new Date();
    const mm = ref.getMonth(),
      dd = ref.getDate();
    for (let t = new Date(p.start); t < p.end; t = addDays(t, 1))
      if (t.getMonth() === mm && t.getDate() === dd) return true;
    return false;
  }
  return false;
}

/** In non-Daily modes, enable checkbox only if TODAY is inside the period
 * and the habit is scheduled today (so toggling is unambiguous).
 */
function canToggleTodayForPeriod(row, period) {
  const today = startOfDayLocal(new Date());
  if (today < period.start || today >= period.end) return false;
  const dailyWindow = { start: today, end: addDays(today, 1) };
  return taskVisibleInPeriodForMode(row, dailyWindow, "daily");
}

/* ---------- Small donut (unchanged) ---------- */
function Donut({ pct = 0, size = 104, stroke = 10, labelTop, labelBottom }) {
  let p = Number(pct);
  if (!Number.isFinite(p)) p = 0;
  if (p <= 1) p = p * 100;
  p = Math.max(0, Math.min(100, p));
  const radius = (size - stroke) / 2,
    cx = size / 2,
    cy = size / 2,
    C = 2 * Math.PI * radius;
  const off = p >= 100 ? 0 : C * (1 - p / 100);
  return (
    <div className="donut">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-label={`${Math.round(p)}%`}>
        <circle cx={cx} cy={cy} r={radius} stroke="#eef1f7" strokeWidth={stroke} fill="none" />
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          stroke="#6b8afd"
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={C}
          strokeDashoffset={off}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`}
        />
        <text x="50%" y="48%" textAnchor="middle" dominantBaseline="middle" fontWeight="700" fontSize="18">
          {Math.round(p)}%
        </text>
      </svg>
      <div className="donut__labels">
        <div className="donut__title" title={labelTop}>
          {labelTop}
        </div>
        <div className="donut__sub muted">{labelBottom}</div>
      </div>
    </div>
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

  // Day habits (selected date)
  const [habitRows, setHabitRows] = useState([]);
  const [isHabitsLoading, setIsHabitsLoading] = useState(false);

  // Today habits map (for non-daily toggles)
  const [todayMap, setTodayMap] = useState({}); // {task_id: {completed: bool}}

  // Period rows (week/month/year)
  const [periodRows, setPeriodRows] = useState([]);
  const [loadingPeriod, setLoadingPeriod] = useState(true);

  // Mode & offset
  const [mode, setMode] = useState("daily"); // daily | weekly | monthly | yearly
  const [offset, setOffset] = useState(0);
  const period = useMemo(() => {
    console.log("Current offset:", offset);
    return computePeriod(mode, offset)
  }, [mode, offset]);

  // UI
  const [error, setError] = useState(null);
  const [booting, setBooting] = useState(true);

  // Calendar selection (for Daily)
  const [date, setDate] = useState(new Date());
  const tz = safeTz();
  const isoDate = useMemo(() => date.toISOString().slice(0, 10), [date]);
  const [activeStartDate, setActiveStartDate] = useState(new Date());

  const API = env.process.API_LINK;
  const today = useMemo(() => startOfDayLocal(new Date()), []);
  const todayIso = useMemo(() => today.toISOString().slice(0, 10), [today]);

  /* ----- helpers to compute offsets from clicks ----- */
  function weeksDiffFromToday(targetDate) {
    const a = startOfISOWeekUTC(new Date());
    const b = startOfISOWeekUTC(new Date(targetDate));
    return Math.round((b - a) / (7 * ONE_DAY));
  }
  function monthsDiffFromToday(targetDate) {
    const t = new Date(targetDate);
    const now = new Date();
    return (
      (t.getUTCFullYear() - now.getUTCFullYear()) * 12 +
      (t.getUTCMonth() - now.getUTCMonth())
    );
  }
  function yearsDiffFromToday(targetDate) {
    console.log("yearsDiffFromToday called:");
    const t = new Date(targetDate);
    const now = new Date();
    console.log("  Target Year:", t.getUTCFullYear());
    console.log("  Current Year:", now.getUTCFullYear());
    const diff = t.getUTCFullYear() - now.getUTCFullYear();
    console.log("  Calculated Difference:", diff);
    return diff
  }

  /* ----- Session ----- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API}/api/me`, { credentials: "include" });
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

  /* ----- Google bootstrap ----- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const tokenRes = await fetch(`${API}/api/auth/token`, {
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
            const calRes = await fetch(`${API}/api/calendar/id`, {
              credentials: "include",
            });
            if (calRes.ok) {
              const data = await calRes.json();
              if (!cancelled) setCalendarID(data.calendarId);
            } else if (!cancelled) setCalendarID(null);
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

  /* ----- Google events: daily AND period ----- */
  const fetchEventsRange = useCallback(
    async (rangeStart, rangeEnd) => {
      if (!calendarId || !hasGoogleToken || !isGapiLoaded) {
        setEvents([]);
        return;
      }
      try {
        const response = await window.gapi.client.calendar.events.list({
          calendarId,
          timeMin: rangeStart.toISOString(),
          timeMax: new Date(rangeEnd.getTime() - 1).toISOString(),
          showDeleted: false,
          singleEvents: true,
          maxResults: 100,
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

  useEffect(() => {
    if (!calendarId || !hasGoogleToken || !isGapiLoaded) return;
    if (mode === "daily") {
      const s = startOfDayLocal(date),
        e = addDays(s, 1);
      fetchEventsRange(s, e);
    } else {
      fetchEventsRange(period.start, period.end);
    }
  }, [calendarId, hasGoogleToken, isGapiLoaded, date, mode, period, fetchEventsRange]);

  /* ----- Habits: selected day list ----- */
  const fetchHabitsForDate = useCallback(
    async (dateStr) => {
      if (!userId) return;
      setIsHabitsLoading(true);
      try {
        const u = new URL(`${API}/habits/day`);
        u.searchParams.set("date", dateStr);
        u.searchParams.set("userId", String(userId));
        const res = await fetch(u.toString(), { credentials: "include" });
        if (!res.ok) throw new Error(`Failed to load habits for ${dateStr}`);
        const data = await res.json();
        const raw = data.rows || [];
        const dayWindow = {
          start: startOfDayLocal(new Date(dateStr)),
          end: addDays(startOfDayLocal(new Date(dateStr)), 1),
        };
        const filtered = raw.filter((r) =>
          taskVisibleInPeriodForMode(r, dayWindow, "daily")
        );
        setHabitRows(filtered);
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

  // Daily list for calendar-selected date
  useEffect(() => {
    if (mode === "daily" && userId) fetchHabitsForDate(isoDate);
  }, [isoDate, userId, mode, fetchHabitsForDate]);

  // Also fetch TODAY’s list once for non-daily toggles
  useEffect(() => {
    if (userId)
      (async () => {
        try {
          const u = new URL(`${API}/habits/day`);
          u.searchParams.set("date", todayIso);
          u.searchParams.set("userId", String(userId));
          const res = await fetch(u.toString(), { credentials: "include" });
          const data = await res.json().catch(() => ({ rows: [] }));
          const map = {};
          (data.rows || []).forEach((r) => {
            map[r.task_id] = { completed: !!r.completed };
          });
          setTodayMap(map);
        } catch {}
      })();
  }, [userId, todayIso]);

  /* ----- Period rows (week/month/year) ----- */
  useEffect(() => {
    if (!userId) return;
    let cancel = false;
    (async () => {
      try {
        setLoadingPeriod(true);
        const r = await fetch(
          `${API}/stats/progress/${mode}?userId=${userId}&tz=${encodeURIComponent(
            safeTz()
          )}&offset=${offset}`,
          { credentials: "include" }
        );
        const data = await r.json().catch(() => []);
        const rows = Array.isArray(data) ? data : [];
        const filtered = rows.filter((row) =>
          taskVisibleInPeriodForMode(row, period, mode)
        );
        if (!cancel) setPeriodRows(filtered);
      } finally {
        if (!cancel) setLoadingPeriod(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [userId, mode, offset, period]);

  /* ----- Toggle (used by both daily + non-daily) ----- */
  const toggleHabit = useCallback(
    async (taskId, nextCompleted, forDateIso) => {
      try {
        const res = await fetch(`${API}/habits/${taskId}/complete`, {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, date: forDateIso, completed: nextCompleted, tz }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || "Failed to update habit completion");
        }
        if (mode === "daily") {
          await fetchHabitsForDate(isoDate);
        }
        // refresh today's map for period checkboxes
        const u = new URL(`${API}/habits/day`);
        u.searchParams.set("date", todayIso);
        u.searchParams.set("userId", String(userId));
        const todayRes = await fetch(u.toString(), { credentials: "include" });
        const data = await todayRes.json().catch(() => ({ rows: [] }));
        const map = {};
        (data.rows || []).forEach((r) => {
          map[r.task_id] = { completed: !!r.completed };
        });
        setTodayMap(map);

        window.dispatchEvent(
          new CustomEvent("streaks:changed", { detail: { taskId, date: forDateIso } })
        );
      } catch (e) {
        console.error(e);
        setError(e.message);
      }
    },
    [userId, isoDate, todayIso, tz, mode, fetchHabitsForDate]
  );

  /* ---------- Calendar sync variables (NO hooks so ESLint is happy) ---------- */
  const periodLabel = period.label;

  const calView =
    mode === "daily" ? "month" : mode === "weekly" ? "month" : mode === "monthly" ? "year" : "decade";

  const calValue =
    mode === "daily"
      ? date
      : mode === "weekly"
      ? [startOfISOWeekUTC(date), addDays(startOfISOWeekUTC(date), 6)]
      : date;
      /*
      ? [period.start, addDays(period.start, 6)]
      : period.start; // a date inside the month/year tile
      */

  const calActiveStartDate =
    mode === "daily" || mode === "weekly"
      ? date
      : mode === "monthly"
      ? new Date(addMonthsUTC(new Date(), offset))
      : mode === "yearly"
      ? new Date(addYearsUTC(new Date(), offset))
      : new Date(period.start.getFullYear() - (period.start.getFullYear() % 10), 0, 1);

  const handleDateChange = (newDate, newView) => {
    console.log("handleDateChange triggered!");
    console.log("Clicked Date:", newDate);
    console.log("New View:", newView);
    console.log("Current Mode:", mode);

    if (Array.isArray(newDate)) {
      setDate(newDate[0]);
    } else {
      setDate(newDate);
    }
    if (newView === "month") {
      if (mode === "weekly") {
        setOffset(weeksDiffFromToday(newDate));
      } else {
        setMode("daily");
        setOffset(0);
      }
    } else if (newView === "year") {
      setMode("monthly");
      setOffset(monthsDiffFromToday(newDate));
      //setOffset(0);
    } else if (newView === "decade") {
      console.log("CLICKED ON A DECADE VIEW. newView is 'decade'.");
      console.log("Selected date:", newDate.toISOString());
      setMode("yearly");
      setOffset(yearsDiffFromToday(newDate));
      //setOffset(0);
    }
  };

  const handleClickDay = (d) => {
    if (mode === "daily") {
      setDate(d);
    } else if (mode === "weekly") {
      setOffset(weeksDiffFromToday(d));
      setDate(d);
    } else {
      // Clicking a day in other modes goes to day view for that date
      setMode("daily");
      const deltaDays = Math.round(
        (startOfDayLocal(d) - startOfDayLocal(new Date())) / ONE_DAY
      );
      setOffset(deltaDays);
      setDate(d);
    }
  };
  const handleClickMonth = (d) => {
    if (mode === "monthly") {
      setDate(d);
      setOffset(monthsDiffFromToday(d));
    }
  };
  const handleClickYear = (d) => {
    console.log("handleClickYear called!");
    console.log("Clicked Date (d):", d);
    if (mode === "yearly") {
      const activeYear = calActiveStartDate.getFullYear();
      const clickedYear = d.getFullYear();
      console.log(`Clicked year: ${clickedYear}. Active start year: ${activeYear}.`);
      const newOffset = offset + (clickedYear - activeYear);
      console.log(`Old offset: ${offset}. New offset will be: ${newOffset}.`);
      //console.log("New offset calculated in handleClickYear:", newOffset);
      setOffset(newOffset);
      setDate(d);
    }
  };
  /*
  const handleActiveStartDateChange = ({ activeStartDate, view }) => {
    console.log("handleActiveStartDateChange called!");
    console.log("  activeStartDate:", activeStartDate);
    console.log("  view:", view);
    console.log("  Current mode:", mode);
    let newOffset = 0;
    const now = new Date();
    if (mode === "daily" || mode === "weekly") {
      setDate(activeStartDate);
    } else {
      if (view === "month") {
        newOffset = monthsDiffFromToday(activeStartDate);
      } else if (view === "year") {
        const diffYears = activeStartDate.getFullYear() - new Date(addMonthsUTC(new Date(), offset)).getFullYear();
        newOffset = offset + diffYears * 12
      } else if (view === "decade") {
        const diffYears = activeStartDate.getFullYear() - new Date(addYearsUTC(new Date(), offset)).getFullYear();
        console.log("  Diff in years (yearly mode):", diffYears);
        console.log("  Current offset:", offset);
        newOffset = offset + diffYears;
        console.log("  New offset from onActiveStartDateChange:", newOffset);
      }
      setOffset(newOffset);
    }
  };
  */
 const handleActiveStartDateChange = ({ activeStartDate, view }) => {
    // These logs will now show a single, clean state update
    console.log("handleActiveStartDateChange called!");
    console.log("  activeStartDate:", activeStartDate);
    console.log("  view:", view);
    console.log("  Current mode:", mode);

    if (mode === "daily" || mode === "weekly") {
      setDate(activeStartDate);
    } else if (mode === "monthly" && view === "year") {
      const diffMonths = (activeStartDate.getFullYear() - date.getFullYear()) * 12 + (activeStartDate.getMonth() - date.getMonth());
      setOffset(offset + diffMonths);
    } else if (mode === "yearly") {
      // This is the correct logic for yearly mode.
      if (view === "decade") {
        // This handles arrow clicks
        const diffYears = activeStartDate.getFullYear() - new Date(addYearsUTC(new Date(), offset)).getFullYear();
        setOffset(offset + diffYears);
      } else if (view === "year") {
        // This handles clicking on a specific year
        const diffYears = activeStartDate.getFullYear() - new Date(addYearsUTC(new Date(), offset)).getFullYear();
        setOffset(offset + diffYears);
      }
    }
  };
  // Function to handle arrow clicks based on the current mode
  const handleArrowClick = (direction) => {
    console.log("Arrow clicked. Current mode:", mode, "Direction:", direction);

    if (mode === "daily") {
      setOffset(o => o + direction);
    } else if (mode === "weekly") {
      setOffset(o => o + direction);
    } else if (mode === "monthly") {
      // Add a console.log here to see the value before and after the update
      setOffset(o => {
        const newOffset = o + (direction * 1); // Change this to a multiplier of 12 for years
        console.log("In monthly mode. Old offset:", o, "New offset:", newOffset);
        return newOffset;
      });
    } else if (mode === "yearly") {
      setOffset(o => o + (direction * 10));
    }
  };


  if (booting || !user) return <div className="App py-8">Loading…</div>;

  // For non-daily Habit list
  const canToggleInPeriod = (row) => canToggleTodayForPeriod(row, period);
  const isCheckedToday = (taskId) => !!todayMap[taskId]?.completed;

  return (
    <div className="dashboard">
      {/* Top nav */}
      <div className="dashboard__topbar">
        <div className="dashboard__brand">Daily Habit Tracker</div>
        <nav className="dashboard__nav">
          <NavButton to="/dashboard">Dashboard</NavButton>
          <NavButton to="/todo">To-Do</NavButton>
          <NavButton to="/calendar">Calendar</NavButton>
        </nav>
      </div>

      <div className="dashboard__container">
        {error && (
          <div className="card card--warn">
            <p className="muted" role="alert">
              {error}
            </p>
          </div>
        )}

        {/* Period controls */}
        <div className="card p-16">
          <div className="insights__header">
            <div className="insights__title">
              <h3 className="mt-0">Calendar & Habits</h3>
              <div className="muted">{periodLabel}</div>
            </div>
            <div className="insights__controls">
              <div className="insights__switch">
                <button
                  className={`seg ${mode === "daily" ? "seg--on" : ""}`}
                  onClick={() => {
                    setMode("daily");
                    setOffset(0);
                  }}
                >
                  Day
                </button>
                <button
                  className={`seg ${mode === "weekly" ? "seg--on" : ""}`}
                  onClick={() => {
                    setMode("weekly");
                    setOffset(0);
                  }}
                >
                  Week
                </button>
                <button
                  className={`seg ${mode === "monthly" ? "seg--on" : ""}`}
                  onClick={() => {
                    setMode("monthly");
                    setOffset(0);
                  }}
                >
                  Month
                </button>
                <button
                  className={`seg ${mode === "yearly" ? "seg--on" : ""}`}
                  onClick={() => {
                    setMode("yearly");
                    setOffset(0);
                  }}
                >
                  Year
                </button>
              </div>
              <div className="insights__arrows">
                <button
                  className="arrow"
                  onClick={() => handleArrowClick(-1)}
                  aria-label="Previous"
                >
                  ←
                </button>
                <button
                  className="arrow"
                  onClick={() => handleArrowClick(1)}
                  aria-label="Next"
                >
                  →
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* SAME LAYOUT for Day / Week / Month / Year */}
        <div className="grid grid--2">
          {/* Calendar */}
          <div className="card p-16">
            <h3 className="mt-0">Calendar</h3>
            {!hasGoogleToken && (
              <p className="caption mb-8">
                Google not linked — habits still available
              </p>
            )}
            <div className="flex flex-col items-center">
              <Calendar
                view={calView}
                value={calValue}
                //value={date}
                //onChange={setDate}
                //onChange={handleDateChange}
                selectRange={mode === "weekly"} /* highlight whole week */
                activeStartDate={calActiveStartDate}
                //activeStartDate={activeStartDate}
                onActiveStartDateChange={handleActiveStartDateChange}
                //minDate={new Date(1900, 0, 1)}
                //maxDate={new Date(2100, 11, 31)}
                //maxDetail="century"
                onClickDay={handleClickDay}
                onClickMonth={handleClickMonth}
                //onClickYear={handleClickYear}
              />
            </div>
          </div>

          {/* Event list */}
          <div className="card p-16">
            <h3 className="mt-0">Event list</h3>
            <p className="muted">
              {mode === "daily"
                ? `Events on ${date.toDateString()}`
                : `Events in ${periodLabel}`}
            </p>
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
              <p className="caption mt-8">
                No events for this {mode === "daily" ? "day" : "period"}.
              </p>
            )}
          </div>
        </div>

        {/* Habit list */}
        <div className="card p-16">
          <h3 className="mt-0">Habit list</h3>
          <p className="muted">
            {mode === "daily"
              ? `Habits for ${date.toDateString()}`
              : `Habits in ${periodLabel}`}
          </p>

          {mode === "daily" ? (
            isHabitsLoading ? (
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
                      onChange={(e) =>
                        toggleHabit(h.task_id, e.target.checked, isoDate)
                      }
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
            )
          ) : loadingPeriod ? (
            <p className="muted">Loading…</p>
          ) : (periodRows || []).length === 0 ? (
            <p className="caption">No habits scheduled for this period.</p>
          ) : (
            <ul className="event-list">
              {periodRows.map((r) => {
                const taskId = r.task_id;
                const enabled = canToggleInPeriod(r);
                const checked = isCheckedToday(taskId);
                return (
                  <li key={taskId} className="flex items-center gap-3">
                    <input
                      id={`p-habit-${taskId}`}
                      type="checkbox"
                      checked={checked}
                      disabled={!enabled}
                      onChange={(e) =>
                        toggleHabit(taskId, e.target.checked, todayIso)
                      }
                    />
                    <label htmlFor={`p-habit-${taskId}`}>
                      {r.activity_name}
                      <span className="muted">
                        {" "}
                        {r.repeat ? `(${r.repeat})` : "(non-repeat)"}
                      </span>
                    </label>
                    {!enabled && (
                      <span className="caption" style={{ marginLeft: "auto" }}>
                        (toggle enabled only if scheduled today)
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Optional donuts summary
        <div className="card p-16">
          <h3 className="mt-0">Habit progress</h3>
          <div className="donut-grid">
            {periodRows.map((r)=>(
              <Donut key={r.task_id}
                pct={r.pct ?? 0}
                labelTop={r.activity_name}
                labelBottom={
                  r.timer ? `${r.progress_minutes||0}/${r.timer} min`
                          : r.counter ? `${r.progress_count||0}/${r.counter}` : "—"
                }/>
            ))}
          </div>
        </div> */}
      </div>
    </div>
  );
}