import React, { useEffect, useState } from 'react';
import '../style/LoginSignup.css';

const API = import.meta.env.VITE_API_LINK;

function SignupPage() {
  const [checking, setChecking] = useState(true);
  const [me, setMe] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API}/api/me`, {
          method: 'GET',
          credentials: 'include',
        });
        if (!cancelled) {
          if (res.ok) {
            const data = await res.json();
            setMe(data);
          } else {
            setMe(null);
          }
        }
      } catch (e) {
        if (!cancelled) setError('Could not verify login status.');
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => (cancelled = true);
  }, []);

  function handleGoogle() {
    window.location.href = `${API}/auth/google`;
  }

  return (
    <div className="auth-form">
      <h2>{me ? 'You are signed in' : 'Welcome'}</h2>

      {checking && <p>Checking session…</p>}

      {!checking && !me && (
        <>
          <button type="button" onClick={handleGoogle} className="google-btn">
            SignUp with Google
          </button>
          {error && <p style={{ color: 'red', marginTop: 8 }}>{error}</p>}
          <p style={{ marginTop: 12 }}>
            Already have an account?  <a href="/">Back to Login</a>

          </p>

        </>
      )}

      {!checking && me && (
        <>
          <p style={{ color: 'green' }}>
            Signed in as <strong>{me.name}</strong> ({me.username})
          </p>
          <a className="primary-link" href="/dashboard">Go to Dashboard</a>
        </>
      )}
    </div>
  );
}

export default SignupPage;
