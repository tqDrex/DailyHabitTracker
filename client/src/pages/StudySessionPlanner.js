import React, { useEffect, useState } from "react";
import '../style/StudySessionPlanner.css';

const API = process.env.REACT_APP_API_LINK;

export default function StudySessionPlanner() {
  const [sessions, setSessions] = useState([]);
  const [form, setForm] = useState({ title: "", subject: "", duration: "", notes: "" });
  const [selectedSession, setSelectedSession] = useState(null);

  // Fetch sessions from backend
  useEffect(() => {
    fetch(`${API}/sessions`)
      .then((res) => res.json())
      .then(setSessions)
      .catch(console.error);
  }, []);

  // Handle form input
  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  // Submit new session
  const handleSubmit = async (e) => {
    e.preventDefault();
    const res = await fetch(`${API}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const newSession = await res.json();
    setSessions([newSession, ...sessions]);
    setForm({ title: "", subject: "", duration: "", notes: "" });
  };

  return (
    <div className="p-6 max-w-xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Study Session Planner</h1>

      {/* New Session Form */}
      <form onSubmit={handleSubmit} className="space-y-4 p-4 border rounded-xl shadow">
        <input
          type="text"
          name="title"
          placeholder="Session Title"
          value={form.title}
          onChange={handleChange}
          className="w-full p-2 border rounded"
          required
        />
        <input
          type="text"
          name="subject"
          placeholder="Subject"
          value={form.subject}
          onChange={handleChange}
          className="w-full p-2 border rounded"
          required
        />
        <input
          type="number"
          name="duration"
          placeholder="Duration (minutes)"
          value={form.duration}
          onChange={handleChange}
          className="w-full p-2 border rounded"
          required
        />
        <textarea
          name="notes"
          placeholder="Notes"
          value={form.notes}
          onChange={handleChange}
          className="w-full p-2 border rounded"
        ></textarea>
        <button type="submit" className="px-4 py-2 bg-blue-500 text-white rounded-lg">
          Save Session
        </button>
      </form>

      {/* Dropdown to select session */}
      <div className="space-y-2">
        <label className="block font-semibold">View Past Sessions</label>
        <select
          className="w-full p-2 border rounded"
          onChange={(e) => setSelectedSession(sessions.find(s => s.id === Number(e.target.value)))}
        >
          <option value="">Select a session</option>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title} ({s.subject})
            </option>
          ))}
        </select>
      </div>

      {/* Display Selected Session */}
      {selectedSession && (
        <div className="p-4 border rounded-xl shadow bg-gray-50">
          <h2 className="text-lg font-bold">{selectedSession.title}</h2>
          <p><strong>Subject:</strong> {selectedSession.subject}</p>
          <br/>
          <p><strong>Duration:</strong> {selectedSession.duration} minutes</p>
          <br/>
          <p><strong>Notes:</strong> {selectedSession.notes}</p>
          <br/>
          <p className="text-sm text-gray-500">
            Created: {new Date(selectedSession.created_at).toLocaleString()}
          </p>
          <br/>
        </div>
      )}
    </div>
  );
}