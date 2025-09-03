import React, { useEffect, useState } from "react";
import "../style/LoginSignup.css";

/* ---------- API base (handles Vite or CRA) ---------- */
const RAW_API =
  // Vite
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_LINK) ||
  // CRA
  (typeof process !== "undefined" && process.env?.REACT_APP_API_LINK) ||
  // fallback to same-origin
  "";

const API_BASE = (RAW_API || window.location.origin).replace(/\/+$/, "");
const buildUrl = (p) => new URL(String(p).replace(/^\/+/, "/"), API_BASE).toString();

export default function SignupPage() {
  const [checking, setChecking] = useState(true);
  const [me, setMe] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    // Debug so you can confirm values in DevTools
    console.log("DEBUG: API_BASE =", API_BASE);
    console.log("DEBUG: /api/me =", buildUrl("/api/me"));

    (async () => {
      try {
        const res = await fetch(buildUrl("/api/me"), {
          method: "GET",
          credentials: "include",
        });
        if (cancelled) return;

        if (res.ok) {
          const data = await res.json();
          setMe(data);
        } else {
          setMe(null);
        }
      } catch (_e) {
        if (!cancelled) setError("Could not verify login status.");
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  function handleGoogle() {
    const authUrl = buildUrl("/auth/google");
    console.log("DEBUG: authUrl =", authUrl);
    // Full page navigation (don’t use React Router for OAuth)
    window.location.assign(authUrl);
  }

  return (
    <div className="auth-form">
      <h2>{me ? "You are signed in" : "Welcome"}</h2>

      {checking && <p>Checking session…</p>}

      {!checking && !me && (
        <>
          <button type="button" onClick={handleGoogle} className="google-btn">
            SignUp with Google
          </button>
          {error && <p style={{ color: "red", marginTop: 8 }}>{error}</p>}
          <p style={{ marginTop: 12 }}>
            Already have an account? <a href="/">Back to Login</a>
          </p>
        </>
      )}

      {!checking && me && (
        <>
          <p style={{ color: "green" }}>
            Signed in as <strong>{me?.name}</strong> ({me?.username})
          </p>
          <a className="primary-link" href="/dashboard">Go to Dashboard</a>
        </>
      )}
    </div>
  );
}
