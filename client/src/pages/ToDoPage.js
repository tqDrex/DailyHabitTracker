import React, { useEffect, useState } from "react";
import "../style/ToDoPage.css";

const API = "http://localhost:3000";

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
        const taskRes = await fetch(`${API}/tasks?userId=${user.id}`, {
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
      repeat: repeat!="none" ? repeat : null,
    };

    try {
      const res = await fetch(`${API}/tasks/createTask?userId=${user.id}`, {
        method: "POST",
        credentials: 'include',
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error("Failed to save task");

      const data = await res.json();
      console.log("Server response:", data);

      // Reset
      setShowModal(false);
      setActivityName("");
      setUseTimer(false);
      setMinutes("");
      setUseCounter(false);
      setTimes("");
      setDeadline("");
      setRepeat("none");
    } catch (e) {
      console.error(e.message);
    }
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
        <button className="circle-btn" onClick={() => setShowModal(!showModal)} aria-label="Add" style={{ marginTop: 16 }}>
          +
        </button>

        {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center">
          <div className="bg-white rounded-2xl shadow-lg p-6 w-96">
            <h2 className="text-xl font-bold mb-4">Create Task</h2>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              {/* Activity Name */}
              <input
                type="text"
                placeholder="Activity Name"
                value={activityName}
                onChange={(e) => setActivityName(e.target.value)}
                className="border rounded-lg px-3 py-2"
                required
              />

              {/* Timer / Counter Checkboxes */}
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={useTimer}
                    onChange={(e) => setUseTimer(e.target.checked)}
                  />
                  Timer
                </label>
                {useTimer && (
                  <input
                    type="number"
                    placeholder="Minutes"
                    value={minutes}
                    onChange={(e) => setMinutes(e.target.value)}
                    className="border rounded-lg px-3 py-2"
                    required
                  />
                )}

                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={useCounter}
                    onChange={(e) => setUseCounter(e.target.checked)}
                  />
                  Counter
                </label>
                {useCounter && (
                  <input
                    type="number"
                    placeholder="Times"
                    value={times}
                    onChange={(e) => setTimes(e.target.value)}
                    className="border rounded-lg px-3 py-2"
                    required
                  />
                )}
              </div>

              {/* Deadline Date */}
              <input
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="border rounded-lg px-3 py-2"
              />

              {/* Repeat Option */}
              <select
                value={repeat}
                onChange={(e) => setRepeat(e.target.value)}
                className="border rounded-lg px-3 py-2"
              >
                <option value="none">None</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="annually">Annually</option>
              </select>

              {/* Buttons */}
              <div className="flex justify-end gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="bg-gray-400 text-white px-3 py-1 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-blue-500 text-white px-3 py-1 rounded-lg"
                >
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
