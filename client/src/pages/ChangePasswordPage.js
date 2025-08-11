import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

const API = "http://localhost:3000";

export default function ChangePasswordPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);

  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Ensure user is logged in
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API}/api/me`, { credentials: "include" });
        if (!res.ok) throw new Error("Not logged in");
        if (!cancelled) setLoading(false);
      } catch {
        if (!cancelled) window.location.href = "/"; // back to login
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const validate = () => {
    setError("");
    if (oldPassword.length === 0) {
      setError("Please enter your current password.");
      return false;
    }
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return false;
    }
    if (newPassword === oldPassword) {
      setError("New password must be different from the old password.");
      return false;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return false;
    }
    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    try {
      const res = await fetch(`${API}/change-password`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldPassword, newPassword }),
      });

      if (res.ok) {
        setSuccess("Password updated successfully.");
        setTimeout(() => navigate("/dashboard"), 800);
      } else if (res.status === 400) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || "Old password incorrect or too weak.");
      } else if (res.status === 403) {
        setError("Session expired. Please log in again.");
        setTimeout(() => (window.location.href = "/"), 800);
      } else {
        setError("Something went wrong. Please try again.");
      }
    } catch {
      setError("Network error. Please try again.");
    }
  };

  if (loading) return <p style={{ padding: 16 }}>Loading…</p>;

  const strength =
    newPassword.length >= 14 ? "strong"
    : newPassword.length >= 10 ? "medium"
    : newPassword.length > 0 ? "weak"
    : "";

  return (
    <div style={{ maxWidth: 480, margin: "40px auto", padding: 24, border: "1px solid #eee", borderRadius: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Change Password</h2>
        <button
          onClick={() => navigate("/dashboard")}
          style={{ background: "transparent", border: "1px solid #ddd", padding: "6px 10px", borderRadius: 6, cursor: "pointer" }}
        >
          Back
        </button>
      </div>

      {/* First-time user info */}
      <div style={{
        backgroundColor: "#e8f4fd",
        border: "1px solid #b6d9f7",
        color: "#084c7f",
        padding: "10px 14px",
        borderRadius: 6,
        marginBottom: 16,
        fontSize: "0.9rem"
      }}>
        If this is your first time logging in with Google, a temporary password
        has been sent to your email. Please use it as your current password below
        and set a new one.
      </div>

      <form onSubmit={handleSubmit}>
        <label style={{ display: "block", margin: "10px 0 6px" }}>Current password</label>
        <input
          type="password"
          value={oldPassword}
          onChange={(e) => setOldPassword(e.target.value)}
          placeholder="Enter current password"
          required
          autoComplete="current-password"
          style={{ width: "100%", padding: 10, borderRadius: 6, border: "1px solid #ccc" }}
        />

        <label style={{ display: "block", margin: "14px 0 6px" }}>New password</label>
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="At least 8 characters"
          required
          autoComplete="new-password"
          style={{ width: "100%", padding: 10, borderRadius: 6, border: "1px solid #ccc" }}
        />
        {strength && (
          <small style={{ color: strength === "strong" ? "green" : strength === "medium" ? "#b8860b" : "crimson" }}>
            Strength: {strength}
          </small>
        )}

        <label style={{ display: "block", margin: "14px 0 6px" }}>Confirm new password</label>
        <input
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="Re-enter new password"
          required
          autoComplete="new-password"
          style={{ width: "100%", padding: 10, borderRadius: 6, border: "1px solid #ccc" }}
        />

        <button
          type="submit"
          style={{
            marginTop: 16,
            width: "100%",
            padding: "10px 14px",
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
            color: "#fff",
            background: "#2563eb"
          }}
        >
          Update Password
        </button>

        {error && <p style={{ color: "crimson", marginTop: 12 }}>{error}</p>}
        {success && <p style={{ color: "green", marginTop: 12 }}>{success}</p>}
      </form>
    </div>
  );
}
