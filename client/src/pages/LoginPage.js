import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import '../style/LoginSignup.css';

const API = env.process.API_LINK; // backend

function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  async function handleLogin(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const res = await fetch(`${API}/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      if (res.ok) {
        navigate('/dashboard');
      } else {
        setError('Invalid credentials');
      }
    } catch (err) {
      console.log('Fetch error:', err);
      setError('Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  function handleGoogleLogin() {
    window.location.href = `${API}/auth/google`;
  }

  return (
    <form onSubmit={handleLogin} className="auth-form">
      <h2>Login</h2>

      <input
        type="text"
        placeholder="Username"
        value={username}
        onChange={e => setUsername(e.target.value)}
        required
      /><br />

      <input
        type="password"
        placeholder="Password"
        value={password}
        onChange={e => setPassword(e.target.value)}
        required
      />
      <small style={{
        display: 'block',
        marginTop: '4px',
        fontSize: '0.85em',
        color: '#666'
      }}>
        Your username is your email without @gmail.com.
      </small>
      <br />

      <button type="submit" disabled={submitting}>
        {submitting ? 'Logging in…' : 'Login'}
      </button>

      {error && <p style={{ color: 'red' }}>{error}</p>}

      <div style={{ margin: '12px 0', textAlign: 'center' }}>— or —</div>

      <button type="button" onClick={handleGoogleLogin} className="google-btn">
        Continue with Google
      </button>

      <p style={{ marginTop: 12 }}>
        Don't have an account? <a href="/signup">Sign up</a>
      </p>
    </form>
  );
}

export default LoginPage;
