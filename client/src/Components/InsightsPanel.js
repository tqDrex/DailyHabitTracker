// src/components/InsightsPanel.js
import { useEffect, useMemo, useState } from "react";

const API = "http://localhost:3000";

/* ---------------- date helpers ---------------- */
function tz() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; }
  catch { return "UTC"; }
}
function startOfDayLocal(d) { const x=new Date(d); x.setHours(0,0,0,0); return x; }
function addDays(d,n){const x=new Date(d); x.setDate(x.getDate()+n); return x;}
function startOfISOWeekUTC(d){
  const u=new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow=(u.getUTCDay()+6)%7; u.setUTCDate(u.getUTCDate()-dow); return u;
}
function monthStartUTC(d){ return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); }
function addMonthsUTC(d,n){ const x=monthStartUTC(d); x.setUTCMonth(x.getUTCMonth()+n); return x; }
function yearStartUTC(d){ return new Date(Date.UTC(d.getUTCFullYear(),0,1)); }
function addYearsUTC(d,n){ const x=yearStartUTC(d); x.setUTCFullYear(x.getUTCFullYear()+n); return x; }

function fmtDay(d){ return d.toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"}); }
function fmtMonth(d){ return d.toLocaleDateString(undefined,{month:"short",year:"numeric"}); }

/** Compute current period bounds (end exclusive) + label */
function computePeriod(window, offset){
  const now=new Date();
  if(window==="daily"){
    const start=startOfDayLocal(addDays(now, offset));
    const end=addDays(start,1);
    return { start, end, label: fmtDay(start) };
  }
  if(window==="weekly"){
    const base=startOfISOWeekUTC(new Date());
    base.setUTCDate(base.getUTCDate() + offset*7);
    const start=new Date(base);
    const end=addDays(start,7);
    const endLabel=addDays(start,6);
    return { start, end, label: `Week of ${fmtDay(start)} – ${fmtDay(endLabel)}` };
  }
  if(window==="monthly"){
    const first=addMonthsUTC(new Date(), offset);
    const next=addMonthsUTC(first,1);
    return { start:first, end:next, label: fmtMonth(first) };
  }
  const y0=addYearsUTC(new Date(), offset), y1=addYearsUTC(y0,1);
  return { start:y0, end:y1, label: String(y0.getUTCFullYear()) };
}

/* ---------------- tiny UI atoms ---------------- */
function nicePct(v){ const n=Math.max(0,Math.min(1,Number(v)||0)); return Math.round(n*100); }
function shortMetric(r){
  if (r.timer)   return `${r.progress_minutes||0}/${r.timer} min`;
  if (r.counter) return `${r.progress_count||0}/${r.counter}`;
  return `0 / 0`;
}

function Donut({ pct=0, size=104, stroke=10, labelTop, labelBottom }){
  const radius=(size-stroke)/2, cx=size/2, cy=size/2;
  const C=2*Math.PI*radius, off=C*(1-Math.max(0,Math.min(100,pct))/100);
  return (
    <div className="donut">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={radius} stroke="#eef1f7" strokeWidth={stroke} fill="none"/>
        <circle cx={cx} cy={cy} r={radius} stroke="#6b8afd" strokeWidth={stroke} fill="none"
          strokeDasharray={C} strokeDashoffset={off} strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`} />
        <text x="50%" y="48%" textAnchor="middle" dominantBaseline="middle" fontWeight="700" fontSize="18">{nicePct(pct)}%</text>
      </svg>
      <div className="donut__labels">
        <div className="donut__title" title={labelTop}>{labelTop}</div>
        <div className="donut__sub muted">{labelBottom}</div>
      </div>
    </div>
  );
}

/* ---------------- main panel ---------------- */
export default function InsightsPanel({ defaultWindow="daily", className="" }) {
  const [mode, setMode]     = useState(defaultWindow);   // daily|weekly|monthly|yearly (repeat filter)
  const [offset, setOffset] = useState(0);               // 0=current, -1 prev, +1 next
  const [rows, setRows]     = useState([]);              // raw from API
  const [loading, setLoading] = useState(true);
  const [user, setUser]       = useState(null);
  const userTz = useMemo(() => tz(), []);

  // session
  useEffect(() => {
    let cancel=false;
    (async()=>{ try{
      const r=await fetch(`${API}/api/me`,{credentials:"include"});
      if(!r.ok) throw new Error();
      const me=await r.json(); if(!cancel) setUser(me);
    }catch{ if(!cancel) setUser(null);} })();
    return ()=>{cancel=true;};
  },[]);

  // fetch stats/progress (any window; we’ll still filter locally to the current period)
  useEffect(() => {
    if (!user?.id) return;
    let cancel=false;
    (async()=>{ try{
      setLoading(true);
      // If you implemented server window endpoints, this will already be narrow.
      const r = await fetch(`${API}/stats/progress/${mode}?userId=${user.id}&tz=${encodeURIComponent(userTz)}&offset=${offset}`, { credentials:"include" });
      const data = await r.json().catch(()=>[]);
      if(!cancel) setRows(Array.isArray(data)?data:[]);
    } finally { if(!cancel) setLoading(false); }})();
    return ()=>{cancel=true;};
  }, [user?.id, mode, offset, userTz]);

  // current period boundaries
  const period = useMemo(() => computePeriod(mode, offset), [mode, offset]);

  // ---- scheduling predicates ----
  function parseDateMaybe(x){
    if (!x) return null;
    const d = new Date(x);
    return isNaN(d) ? null : d;
  }
  // Which repeat group should this row appear in?
  function rowRepeat(row){
    const r = (row.repeat || row.task_repeat || "").toLowerCase();
    if (r==="daily"||r==="weekly"||r==="monthly"||r==="yearly") return r;
    return null; // non-repeating
  }
  // created_at/deadline_date from either snake or camel
  function rowCreatedAt(row){ return parseDateMaybe(row.created_at || row.createdAt); }
  function rowDeadline(row){  return parseDateMaybe(row.deadline_date || row.deadlineDate); }
  // row's bucket time (if server sends multiple buckets)
  function rowBucketStart(row){
    return (
      parseDateMaybe(row.date) ||
      parseDateMaybe(row.day)  ||
      parseDateMaybe(row.wk_start) ||
      parseDateMaybe(row.month_start) ||
      parseDateMaybe(row.when) ||
      null
    );
  }

  // Is this task active during the selected period (respect created/deadline)?
  function isActiveInPeriod(row, p){
    const created = rowCreatedAt(row); // may be null
    const deadline = rowDeadline(row); // may be null
    // Use the *start* of this period for comparisons
    const start = p.start.getTime();
    if (created && start < startOfDayLocal(created).getTime()) return false;
    if (deadline && start > new Date(deadline.getTime()+24*3600*1000-1).getTime()) return false; // after deadline day
    return true;
  }

  // Keep only rows that belong to the selected repeat group *and* lie in the current period
  const filtered = useMemo(() => {
    const { start, end } = period;
    const s = start.getTime(), e = end.getTime();

    return rows.filter((r) => {
      const rep = rowRepeat(r);
      // repeat filter
      if (mode === "daily") {
        // show daily + non-repeating only
        if (rep && rep !== "daily") return false;
      } else if (mode !== rep) {
        return false;
      }

      // created/deadline guard
      if (!isActiveInPeriod(r, period)) return false;

      // bucket/time window guard
      const b = rowBucketStart(r);
      if (!b) return true; // some APIs won't bucket; assume row already matches
      const t = b.getTime();
      return t >= s && t < e;
    });
  }, [rows, period, mode]);

  return (
    <div className={`card ${className}`}>
      <div className="insights__header">
        <div className="insights__title">
          <h3 className="mt-0">Habit Progress</h3>
          <div className="muted">{period.label}</div>
        </div>

        <div className="insights__controls">
          <div className="insights__switch">
            <button className={`seg ${mode==="daily"?"seg--on":""}`}   onClick={()=>{setMode("daily"); setOffset(0);}}  type="button">Day</button>
            <button className={`seg ${mode==="weekly"?"seg--on":""}`}  onClick={()=>{setMode("weekly"); setOffset(0);}} type="button">Week</button>
            <button className={`seg ${mode==="monthly"?"seg--on":""}`} onClick={()=>{setMode("monthly"); setOffset(0);}}type="button">Month</button>
            <button className={`seg ${mode==="annually"?"seg--on":""}`}  onClick={()=>{setMode("yearly"); setOffset(0);}} type="button">Year</button>
          </div>
          <div className="insights__arrows">
            <button className="arrow" onClick={()=>setOffset(o=>o-1)} aria-label="Previous">←</button>
            <button className="arrow" onClick={()=>setOffset(o=>o+1)} aria-label="Next">→</button>
          </div>
        </div>
      </div>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="muted">No habits for this period.</p>
      ) : (
        <div className="donut-grid">
          {filtered.map((r) => (
            <Donut
              key={`${r.task_id}-${rowBucketStart(r)?.toISOString() ?? "nodate"}`}
              pct={r.pct ?? 0}
              labelTop={r.activity_name}
              labelBottom={shortMetric(r)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
