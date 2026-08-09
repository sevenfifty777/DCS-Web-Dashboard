"use client";
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

interface FootholdPlayer {
  name: string;
  credits: number;
  points: number;
  points_spent: number;
  kills_air: number;
  kills_helo: number;
  kills_sam: number;
  kills_ground: number;
  kills_infantry: number;
  deaths: number;
}

export default function LeaderboardPage() {
  const [players, setPlayers] = useState<FootholdPlayer[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchFootholdData = async () => {
    try {
      const res = await apiFetch('/api/foothold');
      if (res.ok) {
        const data = await res.json();
        setPlayers(data.players || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFootholdData();
    const interval = setInterval(fetchFootholdData, 10000); // refresh every 10s
    return () => clearInterval(interval);
  }, []);

  if (loading) return <div style={{ padding: '2rem' }}>Loading leaderboard...</div>;

  const sortedPlayers = [...players].sort((a, b) => b.points - a.points);

  return (
    <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ margin: 0 }}>Persistent Leaderboard</h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
            Live player statistics tracked by the Foothold campaign.
          </p>
        </div>
      </div>

      <div style={{
        backgroundColor: 'var(--bg-secondary)',
        border: '1px solid var(--panel-border)',
        borderRadius: '8px',
        overflow: 'hidden'
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ backgroundColor: 'rgba(0,0,0,0.2)', borderBottom: '1px solid var(--panel-border)' }}>
              <th style={{ padding: '1rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Pilot Name</th>
              <th style={{ padding: '1rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Points</th>
              <th style={{ padding: '1rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Credits</th>
              <th style={{ padding: '1rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Total Kills</th>
              <th style={{ padding: '1rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Deaths</th>
              <th style={{ padding: '1rem', fontWeight: 600, color: 'var(--text-secondary)' }}>K/D Ratio</th>
            </tr>
          </thead>
          <tbody>
            {sortedPlayers.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                  No player data available in the Foothold save file yet.
                </td>
              </tr>
            ) : (
              sortedPlayers.map((p, idx) => {
                const totalKills = p.kills_air + p.kills_helo + p.kills_sam + p.kills_ground + p.kills_infantry;
                const kd = p.deaths === 0 ? totalKills : (totalKills / p.deaths).toFixed(2);
                
                return (
                  <tr key={p.name} style={{ borderBottom: '1px solid var(--panel-border)', backgroundColor: idx % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.1)' }}>
                    <td style={{ padding: '1rem', fontWeight: 500 }}>{p.name}</td>
                    <td style={{ padding: '1rem', color: 'var(--primary)', fontWeight: 600 }}>{p.points}</td>
                    <td style={{ padding: '1rem', color: '#10b981', fontWeight: 600 }}>{p.credits}</td>
                    <td style={{ padding: '1rem' }}>{totalKills}</td>
                    <td style={{ padding: '1rem' }}>{p.deaths}</td>
                    <td style={{ padding: '1rem' }}>{kd}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
