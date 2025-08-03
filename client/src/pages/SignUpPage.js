import React, { useState } from 'react';
import '../style/LoginSignup.css';

function SignupPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false); // new state for success message

  async function handleSignup(e) {
    e.preventDefault();
    console.log('Form submitted');
    setError('');
    setSuccess(false); // reset success message

    console.log('Username entered:', username);
    console.log('Password entered:', password);

    try {
      const res = await fetch('http://localhost:3000/create', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      console.log('Request sent to /create endpoint');

      if (res.ok) {
        console.log('Account creation succeeded');
        setSuccess(true); // show success message
      } else {
        console.log('Account creation failed. Status:', res.status);
        setError('Failed to create account');
      }
    } catch (err) {
      console.log('Fetch error occurred:', err);
      setError('Something went wrong');
    }
  }

  return (
    <form onSubmit={handleSignup} className="auth-form">
      <h2>Sign Up</h2>
      <input
        type="text"
        placeholder="Username"
        value={username}
        onChange={e => {
          console.log('Username input changed:', e.target.value);
          setUsername(e.target.value);
        }}
        required
      /><br />
      <input
        type="password"
        placeholder="Password"
        value={password}
        onChange={e => {
          console.log('Password input changed:', e.target.value);
          setPassword(e.target.value);
        }}
        required
      /><br />
      <button type="submit">Create Account</button>
      {success && <p style={{color: 'green'}}>Account created! Now you can log in.</p>}
      {error && <p style={{color: 'red'}}>{error}</p>}
      <p>Already have an account? <a href="/">Login</a></p>
    </form>
  );
}

export default SignupPage;
