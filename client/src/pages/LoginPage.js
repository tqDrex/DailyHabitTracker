import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import "../style/LoginSignup.css";

/* -------- API base (CRA or Vite) -------- */
const RAW_API = process.env.REACT_APP_API_LINK;


const API_BASE = (RAW_API || window.location.origin).replace(/\/+$/, "");
const buildUrl = (p) => new URL(String(p).replace(/^\/+/, "/"), API_BASE).toString();

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  async function handleLogin(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const res = await fetch(buildUrl("/login"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (res.ok) {
        navigate("/dashboard");
      } else {
        const msg = await safeText(res);
        setError(msg || "Invalid credentials");
      }
    } catch (err) {
      console.error("Fetch error:", err);
      setError("Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  function handleGoogleLogin() {
    const authUrl = buildUrl("/auth/google");
    console.log("DEBUG: API_BASE =", API_BASE);
    console.log("DEBUG: authUrl  =", authUrl);
    // Full page navigation (don’t use <Link> for OAuth)
    window.location.assign(authUrl);
  }

  return (
    <form onSubmit={handleLogin} className="auth-form">
      <h2>Login</h2>

      <input
        type="text"
        placeholder="Username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        required
      />
      <br />

      <input
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      <small style={{ display: "block", marginTop: 4, fontSize: "0.85em", color: "#666" }}>
        Your username is your email without @gmail.com.
      </small>
      <br />

      <button type="submit" disabled={submitting}>
        {submitting ? "Logging in…" : "Login"}
      </button>

      {error && <p style={{ color: "red" }}>{error}</p>}

      <div style={{ margin: "12px 0", textAlign: "center" }}>— or —</div>

      <button type="button" onClick={handleGoogleLogin} className="google-btn">
        Continue with Google
      </button>

      <p style={{ marginTop: 12 }}>
        Don&apos;t have an account? <a href="/signup">Sign up</a>
      </p>
    </form>
  );
}

/* -------- helpers -------- */
async function safeText(res) {
  try {
    const t = await res.text();
    return t && t.length ? t : "";
  } catch {
    return "";
  }
}
