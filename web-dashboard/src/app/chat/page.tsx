"use client";
import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import styles from '../page.module.css';
import { errorMessage } from '@/lib/errors';

export default function Chat() {
  const [message, setMessage] = useState('');
  const [coalition, setCoalition] = useState('COALITION_ALL');
  const [status, setStatus] = useState('');

  const [isAnnouncement, setIsAnnouncement] = useState(false);
  const [displayTime, setDisplayTime] = useState(10);

  const sendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('Sending...');
    try {
      const endpoint = isAnnouncement ? '/api/announcements' : '/api/chat';
      const payload = isAnnouncement 
        ? { message, coalition: coalition === 'COALITION_ALL' ? 'ALL' : coalition, display_time: displayTime }
        : { message, coalition };

      const res = await apiFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        setStatus('Message sent!');
        setMessage('');
        setTimeout(() => setStatus(''), 3000);
      } else {
        setStatus(`Error: ${data.error}`);
      }
    } catch (err: unknown) {
      setStatus(`Error: ${errorMessage(err)}`);
    }
  };

  return (
    <main className={styles.main}>
      <h1>Server Chat / Announcements</h1>
      <div style={{ background: 'var(--card-bg)', border: '1px solid var(--panel-border)', borderRadius: '2px', padding: '15px' }}>
        <form onSubmit={sendChat} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>Target Coalition</label>
            <select 
              value={coalition} 
              onChange={(e) => setCoalition(e.target.value)}
              style={{ background: 'var(--background)', border: '1px solid var(--panel-border)', color: 'var(--primary)', padding: '10px', fontFamily: 'var(--font-mono)', fontSize: '14px', outline: 'none' }}
            >
              <option value="COALITION_ALL">All Players</option>
              <option value="COALITION_RED">Red Team</option>
              <option value="COALITION_BLUE">Blue Team</option>
              <option value="COALITION_NEUTRAL">Neutral</option>
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>Message</label>
            <input 
              type="text" 
              value={message} 
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Enter message to broadcast..."
              required
              style={{ background: 'var(--background)', border: '1px solid var(--panel-border)', color: 'var(--foreground)', padding: '10px', fontFamily: 'var(--font-ui)', fontSize: '14px', outline: 'none' }}
            />
          </div>
          
          <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: 'var(--text-dim)', cursor: 'pointer' }}>
              <input 
                type="checkbox" 
                checked={isAnnouncement} 
                onChange={(e) => setIsAnnouncement(e.target.checked)}
                style={{ accentColor: 'var(--primary)' }}
              />
              Send as Screen Text (Announcement)
            </label>
            
            {isAnnouncement && (
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: 'var(--text-dim)' }}>
                Display Time (s):
                <input 
                  type="number" 
                  value={displayTime} 
                  onChange={(e) => setDisplayTime(parseInt(e.target.value) || 10)}
                  min="1" max="60"
                  style={{ width: '60px', background: 'var(--background)', border: '1px solid var(--panel-border)', color: 'var(--foreground)', padding: '5px', outline: 'none' }}
                />
              </label>
            )}
          </div>

          <button 
            type="submit"
            style={{ marginTop: '10px', padding: '10px', background: 'transparent', border: '1px solid var(--success)', color: 'var(--success)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', fontWeight: 700, cursor: 'pointer', letterSpacing: '1px', transition: 'all 0.2s' }}
            onMouseOver={(e) => { e.currentTarget.style.background = 'rgba(57, 211, 83, 0.1)'; }}
            onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            Send Broadcast
          </button>
          {status && <p style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{status}</p>}
        </form>
      </div>
    </main>
  );
}
