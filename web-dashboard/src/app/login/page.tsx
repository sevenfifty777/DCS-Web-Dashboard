"use client";
import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { setToken } from '@/lib/api';

function LoginContent() {
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState('');
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const queryToken = searchParams.get('token');
    if (queryToken) {
      setToken(queryToken);
      router.replace('/');
      return;
    }

    if (typeof window !== 'undefined' && window.location.hash.startsWith('#token=')) {
      const token = decodeURIComponent(window.location.hash.slice('#token='.length));
      if (token) {
        setToken(token);
        window.location.hash = '';
        router.replace('/');
        return;
      }
    }
  }, [searchParams, router]);

  const error = formError || searchParams.get('error')?.replace(/\+/g, ' ') || '';

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });

      const data = await res.json();
      if (res.ok && data.token) {
        setToken(data.token);
        router.replace('/');
      } else {
        setFormError(data.error || 'Login failed');
      }
    } catch {
      setFormError('An error occurred during login');
    }
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: 'var(--background)' }}>
      <div style={{ background: 'var(--card-bg)', border: '1px solid var(--panel-border)', borderRadius: '2px', padding: '40px', width: '380px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontFamily: 'var(--font-mono)', color: 'var(--primary)', textAlign: 'center', margin: 0, letterSpacing: '2px' }}>RESTRICTED ACCESS</h1>
        <p style={{ color: 'var(--text-dim)', fontSize: '12px', textAlign: 'center', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>DCS Server Management Authentication</p>
        
        {/* Discord Login Button */}
        <a 
          href="/api/auth/discord"
          style={{ 
            padding: '12px', 
            background: '#5865F2', 
            border: 'none',
            borderRadius: '4px',
            color: '#fff', 
            fontFamily: 'var(--font-sans)', 
            fontWeight: 700, 
            cursor: 'pointer', 
            letterSpacing: '1px', 
            transition: 'all 0.2s',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '10px',
            textDecoration: 'none'
          }}
          onMouseOver={(e) => { e.currentTarget.style.background = '#4752C4'; }}
          onMouseOut={(e) => { e.currentTarget.style.background = '#5865F2'; }}
        >
          <svg width="24" height="24" viewBox="0 0 127.14 96.36" fill="#fff">
            <path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a67.55,67.55,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1,105.25,105.25,0,0,0,32.19-16.14c0,0,.04-.06.04-.09C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.31,60,73.31,53s5-12.74,11.43-12.74S96.1,46,96,53,91,65.69,84.69,65.69Z"/>
          </svg>
          Login with Discord
        </a>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: '10px 0' }}>
          <div style={{ flex: 1, height: '1px', background: 'var(--panel-border)' }}></div>
          <span style={{ color: 'var(--text-dim)', fontSize: '11px', fontFamily: 'var(--font-mono)' }}>OR MASTER PASSWORD</span>
          <div style={{ flex: 1, height: '1px', background: 'var(--panel-border)' }}></div>
        </div>

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <input 
            type="password" 
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter Admin Password"
            style={{ 
              background: 'var(--background)', 
              border: '1px solid var(--panel-border)', 
              color: 'var(--primary)', 
              padding: '12px', 
              fontFamily: 'var(--font-mono)', 
              fontSize: '14px', 
              outline: 'none',
              textAlign: 'center',
              letterSpacing: '3px'
            }}
          />
          <button 
            type="submit"
            style={{ 
              padding: '12px', 
              background: 'rgba(0, 212, 255, 0.1)', 
              border: '1px solid var(--border-highlight)', 
              color: 'var(--primary)', 
              fontFamily: 'var(--font-mono)', 
              textTransform: 'uppercase', 
              fontWeight: 700, 
              cursor: 'pointer', 
              letterSpacing: '2px', 
              transition: 'all 0.2s' 
            }}
            onMouseOver={(e) => { e.currentTarget.style.background = 'rgba(0, 212, 255, 0.2)'; }}
            onMouseOut={(e) => { e.currentTarget.style.background = 'rgba(0, 212, 255, 0.1)'; }}
          >
            Authenticate
          </button>
        </form>
        {error && <p style={{ color: 'var(--danger)', fontSize: '12px', textAlign: 'center', fontFamily: 'var(--font-mono)', marginTop: '10px' }}>{error}</p>}
      </div>
    </div>
  );
}

export default function Login() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <LoginContent />
    </Suspense>
  );
}
