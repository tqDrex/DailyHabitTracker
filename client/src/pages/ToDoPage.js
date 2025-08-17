import React, { useEffect, useState } from 'react';
import '../style/ToDoPage.css';

const API = 'http://localhost:3000';

export default function ToDoPage() {
const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/`)
    fetch(`${API}/tasks`, { credentials: "include" })
      .then((res) => res.json())
      .then((data) => {
        setRows(data.rows);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Error fetching tasks:", err);
        setLoading(false);
      })
  });

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
