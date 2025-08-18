import React, { useEffect, useState } from "react";
import "../style/ToDoPage.css";

const API = "http://localhost:3000";

export default function ToDoPage() {
  const [user, setUser] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  // 1) Load session/user
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

  // 2) Load tasks after we have a user
  useEffect(() => {
    if (!user?.id) return;
    const ac = new AbortController();

    (async () => {
      try {
        setLoading(true);
        const taskRes = await fetch(`${API}/tasks`, {
          credentials: "include",
          signal: ac.signal,
        });
        if (!taskRes.ok) throw new Error("Task load failed");
        // /tasks returns an array (not {rows})
        const taskRows = await taskRes.json();
        if (!ac.signal.aborted) setRows(taskRows || []);
      } catch {
        if (!ac.signal.aborted) setRows([]);
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    })();

    return () => ac.abort();
  }, [user?.id]);

  const addRow = () => {
    const newId = rows.length + 1;
    const newRow = { id: newId, activity_name: `Item ${newId}` };
    setRows((r) => [...r, newRow]);
  };

  const onClick = () => {
    alert("Plus button clicked!");
    addRow();
  };

  if (loading) return <p>Loading Tasks...</p>;

  return (
    <div>
      <h1>To-Do Page</h1>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ borderStyle: "ridge", borderWidth: 10 }}>
          <table border="1" cellPadding="10" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th>Activity Name</th>
                <th>Timer</th>
                <th>Counter</th>
                <th>Deadline Date</th>
                <th>Repeat</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.activity_name}</td>
                  <td>{row.timer}</td>
                  <td>{row.counter}</td>
                  <td>{row.deadline_date}</td>
                  <td>{row.repeat}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button className="circle-btn" onClick={onClick} aria-label="Add" style={{ marginTop: 16 }}>
          +
        </button>
      </div>
    </div>
  );
}
