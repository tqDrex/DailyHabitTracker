import React, { useState } from 'react';
import '../style/ToDoPage.css';

export default function ToDoPage() {
  const [rows, setRows] = useState([
    { id: 1, name: "Item 1" }
  ]);

  const addRow = () => {
    const newId = rows.length + 1;
    const newRow = { id: newId, name: `Item ${newId}` };
    setRows([...rows, newRow]);
  };

  const onClick = () => {
    alert("Plus button clicked!");
    addRow();
  };

  return (
    <div>
      <h1>To-Do Page</h1>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div border="10" style={{borderStyle: "ridge"}}>
          <table border="1" cellPadding="10" style={{borderCollapse: 'collapse'}}>
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.id}>
                  <td>{row.id}</td>
                  <td>{row.name}</td>
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
