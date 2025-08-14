import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import "../style/Dashboard.css";

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

export default function DashboardPage() {
  const [user, setUser] = useState(null);
  const [emailInput, setEmailInput] = useState("");
  const [emailError, setEmailError] = useState("");
  const [emailSuccess, setEmailSuccess] = useState("");
  const navigate = useNavigate();

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

  const handleLogout = async () => {
    try {
      await fetch("http://localhost:3000/logout", {
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
      const res = await fetch("http://localhost:3000/api/link-email", {
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

  if (!user) return <p>Loading...</p>;

  return (
    <div className="dashboard">
      <div className="dashboard__topbar">
        <div className="dashboard__brand">Daily Habit Tracker</div>

        <nav className="dashboard__nav">
          <NavButton to="/todo">To-Do</NavButton>
          <NavButton to="/calendar">Calendar</NavButton>
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
          <div className="card" style={{ borderLeft: "6px solid #f59e0b", marginTop: 0 }}>
            <p className="muted" style={{ margin: 0 }}>
              First time here? A temporary password was emailed to you. Please change it now.
            </p>
          </div>
        )}

        {/* If email is missing, show email linking form */}
        {!user.email && (
          <div className="card" style={{ borderLeft: "6px solid #3f51b5" }}>
            <h3>Link Your Email</h3>
            <p className="muted">We recommend linking an email for password recovery and notifications.</p>
            <input
              type="email"
              placeholder="Enter your email"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              style={{ width: "100%", padding: "0.6rem", marginTop: "0.5rem", borderRadius: "6px", border: "1px solid #ccc" }}
            />
            <button className="btn btn--primary" style={{ marginTop: "0.6rem" }} onClick={handleEmailLink}>
              Link Email
            </button>
            {emailError && <p style={{ color: "crimson" }}>{emailError}</p>}
            {emailSuccess && <p style={{ color: "green" }}>{emailSuccess}</p>}
          </div>
        )}

        <div className="card">
          <div className="card__header">
            {user.avatarUrl && <img className="avatar" src={user.avatarUrl} alt="Avatar" />}
            <div>
              <h1 style={{ marginBottom: 6 }}>Welcome, {user.name ?? user.username}!</h1>
              <p className="muted">Email: {user.email ?? "—"}</p>
            </div>
          </div>

          <div className="grid grid--2">
            <div className="card">
              <h3>Today</h3>
              <p className="muted">Your quick summary goes here.</p>
            </div>
            <div className="card">
              <h3>Streaks</h3>
              <p className="muted">Build something awesome ✨</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
