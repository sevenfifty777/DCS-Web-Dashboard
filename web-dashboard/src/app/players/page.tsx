"use client";
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import styles from '../page.module.css';

export default function Players() {
  const [players, setPlayers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/api/players')
      .then(r => r.json())
      .then(data => {
        setPlayers(data.players || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleKick = async (id: number) => {
    if (!confirm('Are you sure you want to kick this player?')) return;
    try {
      const res = await apiFetch('/api/players/kick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, message: 'Kicked by admin via dashboard' })
      });
      if (res.ok) {
        alert('Player kicked');
        // Refresh players list
        const refreshed = await apiFetch('/api/players').then(r => r.json());
        setPlayers(refreshed.players || []);
      } else {
        alert('Failed to kick player');
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleBan = async (id: number) => {
    if (!confirm('Are you sure you want to BAN this player?')) return;
    const period = parseInt(prompt('Ban duration (minutes, 0 for permanent):', '0') || '0');
    try {
      const res = await apiFetch('/api/players/ban', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, period: period * 60 }) // convert to seconds if period is in seconds in DCS, wait, period is likely seconds. Let's pass minutes * 60 or just pass what they type. Actually wait, period is just an integer in the proto. Let's just pass period directly.
      });
      if (res.ok) alert('Player banned');
      else alert('Failed to ban player');
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <main className={styles.main}>
      <h1>Players ({players.length})</h1>
      {loading ? <p>Loading players...</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {players.length === 0 ? <p style={{ color: 'var(--text-muted)' }}>No players connected.</p> : null}
          {players.map((p, i) => (
            <div key={i} style={{ background: 'var(--card-bg)', border: '1px solid var(--panel-border)', borderRadius: '2px', padding: '10px 15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
              <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--foreground)', fontFamily: 'var(--font-ui)' }}>{p.name}</span>
              <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>Ping: {p.ping}ms</span>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>Slot: <span style={{ color: 'var(--primary)', fontWeight: 700 }}>{p.slot || 'Spectator'}</span></span>
                <span style={{ fontSize: '10px', padding: '2px 4px', border: '1px solid var(--panel-border)', borderRadius: '2px', color: 'var(--success)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>{p.coalition}</span>
                <button 
                  onClick={() => handleKick(p.id)}
                  style={{ background: 'transparent', border: '1px solid var(--danger)', color: 'var(--danger)', padding: '2px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}
                >
                  Kick
                </button>
                <button 
                  onClick={() => handleBan(p.id)}
                  style={{ background: 'var(--danger)', border: 'none', color: '#fff', padding: '3px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}
                >
                  Ban
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
