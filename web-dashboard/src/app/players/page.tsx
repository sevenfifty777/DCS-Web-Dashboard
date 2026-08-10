"use client";
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import styles from '../page.module.css';

export default function Players() {
  const [players, setPlayers] = useState<any[]>([]);
  const [bannedPlayers, setBannedPlayers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'connected' | 'banned'>('connected');

  useEffect(() => {
    Promise.all([
      apiFetch('/api/players').then(r => r.json()),
      apiFetch('/api/players/banned').then(r => r.json())
    ])
    .then(([playersData, bannedData]) => {
      setPlayers(playersData.players || []);
      setBannedPlayers(bannedData.bans || []);
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
        body: JSON.stringify({ id, period: period * 60 })
      });
      if (res.ok) {
        alert('Player banned');
        // Refresh both lists
        const [playersData, bannedData] = await Promise.all([
          apiFetch('/api/players').then(r => r.json()),
          apiFetch('/api/players/banned').then(r => r.json())
        ]);
        setPlayers(playersData.players || []);
        setBannedPlayers(bannedData.bans || []);
      } else {
        alert('Failed to ban player');
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleUnban = async (ucid: string) => {
    if (!confirm('Are you sure you want to UNBAN this player?')) return;
    try {
      const res = await apiFetch('/api/players/unban', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ucid })
      });
      if (res.ok) {
        alert('Player unbanned');
        const bannedData = await apiFetch('/api/players/banned').then(r => r.json());
        setBannedPlayers(bannedData.bans || []);
      } else {
        alert('Failed to unban player');
      }
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <main className={styles.main}>
      <h1>Players & Bans</h1>
      
      <div style={{ display: 'flex', gap: '15px', marginBottom: '20px', borderBottom: '1px solid var(--panel-border)', paddingBottom: '10px' }}>
        <button 
          onClick={() => setActiveTab('connected')}
          style={{ background: 'transparent', border: 'none', color: activeTab === 'connected' ? 'var(--primary)' : 'var(--text-muted)', fontSize: '16px', fontWeight: activeTab === 'connected' ? 700 : 400, cursor: 'pointer' }}
        >
          Connected ({players.length})
        </button>
        <button 
          onClick={() => setActiveTab('banned')}
          style={{ background: 'transparent', border: 'none', color: activeTab === 'banned' ? 'var(--primary)' : 'var(--text-muted)', fontSize: '16px', fontWeight: activeTab === 'banned' ? 700 : 400, cursor: 'pointer' }}
        >
          Banned ({bannedPlayers.length})
        </button>
      </div>

      {loading ? <p>Loading...</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {activeTab === 'connected' && players.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No players connected.</p>}
          {activeTab === 'connected' && players.map((p, i) => (
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

          {activeTab === 'banned' && bannedPlayers.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No banned players.</p>}
          {activeTab === 'banned' && bannedPlayers.map((p, i) => (
            <div key={i} style={{ background: 'var(--card-bg)', border: '1px solid var(--panel-border)', borderRadius: '2px', padding: '10px 15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--danger)', fontFamily: 'var(--font-ui)', marginRight: '10px' }}>{p.player_name || 'Unknown Player'}</span>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{p.ucid}</span>
              </div>
              <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{p.reason || 'No reason provided'}</span>
                <button 
                  onClick={() => handleUnban(p.ucid)}
                  style={{ background: 'transparent', border: '1px solid var(--primary)', color: 'var(--primary)', padding: '2px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}
                >
                  Unban
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
