// src/Components/InsightsPanel.js
import { useEffect, useMemo, useState } from "react";

const API = "http://localhost:3000";

/* ----------------------------- date helpers ----------------------------- */
function tz() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; }
  catch { return "UTC"; }
}
function startOfDayLocal(d){ const x=new Date(d); x.setHours(0,0,0,0); return x; }
function addDays(d,n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }
function startOfISOWeekUTC(d){
  const u=new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow=(u.getUTCDay()+6)%7; u.setUTCDate(u.getUTCDate()-dow); return u;
}
function monthStartUTC(d){ return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); }
function addMonthsUTC(d,n){ const x=monthStartUTC(d); x.setUTCMonth(x.getUTCMonth()+n); return x; }
function yearStartUTC(d){ return new Date(Date.UTC(d.getUTCFullYear(),0,1)); }
function addYearsUTC(d,n){ const x=yearStartUTC(d); x.setUTCFullYear(x.getUTCFullYear()+n); return x; }
function fmtMonth(d){ return d.toLocaleDateString(undefined,{month:"short",year:"numeric"}); }
function fmtDay(d){ return d.toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"}); }

function computePeriod(window, offset){
  const now = new Date();
  if (window === "daily") {
    const start = startOfDayLocal(addDays(now, offset));
    const end = addDays(start, 1);
    return { start, end, label: fmtDay(start) };
  }
  if (window === "weekly") {
    const base = startOfISOWeekUTC(new Date());
    base.setUTCDate(base.getUTCDate() + offset * 7);
    const start = new Date(base);
    const end = addDays(start, 7);
    const endLabel = addDays(start,6);
    return { start, end, label: `Week of ${fmtDay(start)} – ${fmtDay(endLabel)}` };
  }
  if (window === "monthly") {
    const first = addMonthsUTC(new Date(), offset);
    const next  = addMonthsUTC(first, 1);
    return { start:first, end:next, label: fmtMonth(first) };
  }
  const y0 = addYearsUTC(new Date(), offset), y1 = addYearsUTC(y0, 1);
  return { start:y0, end:y1, label: String(y0.getUTCFullYear()) };
}

/* ---------------------- rules + repeat filter helpers ------------------- */
const ONE_DAY = 24*3600*1000;
function parseMaybeDate(x){ if(!x) return null; const d=new Date(x); return isNaN(d)?null:d; }

function repeatMatchesMode(rep, mode){
  const r = (rep || "").toLowerCase();
  if (mode === "daily")   return !r || r === "daily"; // include non-repeating + daily
  if (mode === "weekly")  return r === "weekly";
  if (mode === "monthly") return r === "monthly";
  if (mode === "yearly")  return r === "yearly";
  return false;
}

/** Clamp [start,end) by "not before today" and "not after deadline".
 *  For non-repeating tasks we also clamp by createdAt if provided.
 */
function clampByRules(period, row){
  const today = startOfDayLocal(new Date());

  const deadline = row.deadline_date || row.deadlineDate
    ? startOfDayLocal(new Date(row.deadline_date || row.deadlineDate))
    : null;

  const created = row.created_at || row.createdAt
    ? startOfDayLocal(new Date(row.created_at || row.createdAt))
    : null;

  const nonRepeating = !(row.repeat || row.task_repeat);
  const lower = nonRepeating && created
    ? new Date(Math.max(today.getTime(), created.getTime()))
    : today;

  const start = new Date(Math.max(period.start.getTime(), lower.getTime()));
  let end = new Date(period.end);

  if (deadline) {
    const deadlineEnd = new Date(deadline.getTime() + ONE_DAY);
    end = new Date(Math.min(end.getTime(), deadlineEnd.getTime()));
  }

  if (end <= start) return null;
  return { start, end };
}

/** True if row is relevant for mode and has any occurrence in clamped window */
function rowVisibleForMode(row, period, mode){
  if (!repeatMatchesMode(row.repeat || row.task_repeat, mode)) return false;

  const p = clampByRules(period, row);
  if (!p) return false;

  const rep = (row.repeat || row.task_repeat || "").toLowerCase();

  // Non-repeating: DAILY view — show on any day from max(today, createdAt) up to deadline (if any)
  if (!rep) {
    if (mode !== "daily") return false;
    return p.end > p.start;
  }

  // Repeating cases:
  if (rep === "daily") return p.end > p.start;

  if (rep === "weekly") {
    // Use current weekday as anchor
    const anchorDow = startOfDayLocal(new Date()).getDay();
    for (let t = new Date(p.start); t < p.end; t = addDays(t,1)) {
      if (t.getDay() === anchorDow) return true;
    }
    return false;
  }

  if (rep === "monthly") {
    // Use day-of-month from deadline if present, else today
    const ref = parseMaybeDate(row.deadline_date || row.deadlineDate) || new Date();
    const dom = startOfDayLocal(ref).getDate();
    for (let t = new Date(p.start); t < p.end; t = addDays(t,1)) {
      if (t.getDate() === dom) return true;
    }
    return false;
  }

  if (rep === "yearly") {
    const ref = parseMaybeDate(row.deadline_date || row.deadlineDate) || new Date();
    const mm = ref.getMonth(), dd = ref.getDate();
    for (let t = new Date(p.start); t < p.end; t = addDays(t,1)) {
      if (t.getMonth() === mm && t.getDate() === dd) return true;
    }
    return false;
  }

  return false;
}

/* -------------------------------- Donut -------------------------------- */
function Donut({ pct = 0, size = 104, stroke = 10, labelTop, labelBottom }) {
  // Normalize: accept 0–1 or 0–100 (fixes 100% "sliver" too)
  let p = Number(pct);
  if (!Number.isFinite(p)) p = 0;
  if (p <= 1) p = p * 100;
  p = Math.max(0, Math.min(100, p));
  const radius = (size - stroke) / 2;
  const cx = size / 2, cy = size / 2;
  const C = 2 * Math.PI * radius;
  const off = p >= 100 ? 0 : C * (1 - p / 100);

  return (
    <div className="donut">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-label={`${Math.round(p)}%`}>
        <circle cx={cx} cy={cy} r={radius} stroke="#eef1f7" strokeWidth={stroke} fill="none" />
        <circle
          cx={cx} cy={cy} r={radius}
          stroke="#6b8afd" strokeWidth={stroke} fill="none"
          strokeDasharray={C} strokeDashoffset={off} strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`}
        />
        <text x="50%" y="48%" textAnchor="middle" dominantBaseline="middle" fontWeight="700" fontSize="18">
          {Math.round(p)}%
        </text>
      </svg>
      <div className="donut__labels">
        <div className="donut__title" title={labelTop}>{labelTop}</div>
        <div className="donut__sub muted">{labelBottom}</div>
      </div>
    </div>
  );
}

/* --------------------------- Insights Panel ---------------------------- */
export default function InsightsPanel({ defaultWindow = "daily" }) {
  const [mode, setMode] = useState(defaultWindow);         // daily | weekly | monthly | yearly
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const period = useMemo(() => computePeriod(mode, offset), [mode, offset]);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        setLoading(true);
        const res = await fetch(
          `${API}/stats/progress/${mode}?tz=${encodeURIComponent(tz())}&offset=${offset}`,
          { credentials: "include" }
        );
        const data = await res.json().catch(() => []);
        const list = Array.isArray(data) ? data : [];

        // Enforce repeat-type + clamp rules on client
        const filtered = list.filter((r) => rowVisibleForMode(r, period, mode));
        if (!cancel) setRows(filtered);
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [mode, offset, period]);

  // Optional: refresh when progress added elsewhere
  useEffect(() => {
    const onBump = () => setOffset((o) => o);
    window.addEventListener("progress:added", onBump);
    return () => window.removeEventListener("progress:added", onBump);
  }, []);

  return (
    <div className="card p-16">
      <div className="insights__header">
        <div className="insights__title">
          <h3 className="mt-0">Habit progress</h3>
          <div className="muted">{period.label}</div>
        </div>
        <div className="insights__controls">
          <div className="insights__switch">
            <button className={`seg ${mode==="daily"?"seg--on":""}`}   onClick={()=>{setMode("daily"); setOffset(0);}}>Day</button>
            <button className={`seg ${mode==="weekly"?"seg--on":""}`}  onClick={()=>{setMode("weekly"); setOffset(0);}}>Week</button>
            <button className={`seg ${mode==="monthly"?"seg--on":""}`} onClick={()=>{setMode("monthly"); setOffset(0);}}>Month</button>
            <button className={`seg ${mode==="yearly"?"seg--on":""}`}  onClick={()=>{setMode("yearly"); setOffset(0);}}>Year</button>
          </div>
          <div className="insights__arrows">
            <button className="arrow" onClick={()=>setOffset(o=>o-1)} aria-label="Previous">←</button>
            <button className="arrow" onClick={()=>setOffset(o=>o+1)} aria-label="Next">→</button>
          </div>
        </div>
      </div>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted">No habits for this period.</p>
      ) : (
        <div className="donut-grid">
          {rows.map((r) => (
            <Donut
              key={`${r.task_id}-${r.activity_name}`}
              pct={r.pct ?? r.pct_done ?? 0}
              labelTop={r.activity_name || r.title || "Untitled"}
              labelBottom={
                r.timer
                  ? `${r.progress_minutes || 0}/${r.timer} min`
                  : r.counter
                  ? `${r.progress_count || 0}/${r.counter}`
                  : "—"
              }
            />
          ))}
        </div>
      )}

      <p className="caption mt-8">Toggle completion is available in Day view.</p>
    </div>
  );
}
