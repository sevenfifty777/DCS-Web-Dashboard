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
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
