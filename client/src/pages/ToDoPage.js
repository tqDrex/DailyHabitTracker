import React, { useEffect, useState } from 'react';
import '../style/ToDoPage.css';

const API = 'http://localhost:3000';

export default function ToDoPage() {
  const [user, setUser] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        const res = await fetch("http://localhost:3000/api/me", {
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

  useEffect(() => {
    if (!user?.id) return;
    const ac = new AbortController();

    (async () => {
      try{
        setLoading(true);
        const taskRes = await Promise(fetch(`${API}/tasks?userId=${user.id}`, {
            credentials: "include",
            signal: ac.signal,
          }));
          const taskRows = await Promise(
            taskRes.json()
          );
          if(!ac.signal.aborted) {
            setRows(data.rows);
          }
      } catch {
        if (!ac.signal.aborted) {
          setRows([]);
        }
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    })
  })();


  const addRow = () => {
    const newId = rows.length + 1;
    const newRow = { id: newId, name: `Item ${newId}` };
    setRows([...rows, newRow]);
  };

  const onClick = () => {
    alert("Plus button clicked!");
    addRow();
  };

  if (loading) return <p>Loading Tasks...</p>;

  return (
    <div>
      <h1>To-Do Page</h1>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div border="10" style={{borderStyle: "ridge"}}>
          <table border="1" cellPadding="10" style={{borderCollapse: 'collapse'}}>
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
              {rows.map(row => (
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
        <button className="circle-btn" onClick={onClick} aria-label="Add" style={{marginTop: '16px'}}>
          +
        </button>
      </div>
    </div>
  );
}
