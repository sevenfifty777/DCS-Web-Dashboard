'use client';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

export default function AccessLogsPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLogs = () => {
    apiFetch('/api/logs/access')
      .then(r => r.json())
      .then(data => {
        if (data.logs) setLogs(data.logs);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 10000); // refresh every 10s
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return <div style={{ padding: '2rem', color: 'var(--text-secondary)' }}>Loading access logs...</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '2rem' }}>
      <div>
        <h1>Access Logs</h1>
        <p style={{ color: 'var(--text-secondary)' }}>
          Monitor all Discord authentication attempts to your dashboard. Only the last 1000 events are kept.
        </p>
      </div>

      <div style={{ 
        backgroundColor: '#0b1118', 
        border: '1px solid var(--panel-border)', 
        borderRadius: '4px',
        overflowX: 'auto'
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ backgroundColor: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--panel-border)' }}>
              <th style={{ padding: '1rem', color: 'var(--text-secondary)', fontWeight: 'normal' }}>Timestamp</th>
              <th style={{ padding: '1rem', color: 'var(--text-secondary)', fontWeight: 'normal' }}>User</th>
              <th style={{ padding: '1rem', color: 'var(--text-secondary)', fontWeight: 'normal' }}>Discord ID</th>
              <th style={{ padding: '1rem', color: 'var(--text-secondary)', fontWeight: 'normal' }}>Status</th>
              <th style={{ padding: '1rem', color: 'var(--text-secondary)', fontWeight: 'normal' }}>Details</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-dim)' }}>
                  No authentication logs found.
                </td>
              </tr>
            ) : (
              logs.map((log, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--panel-border)', backgroundColor: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                  <td style={{ padding: '1rem', color: '#fff', fontFamily: 'var(--font-mono)' }}>
                    {new Date(log.timestamp).toLocaleString()}
                  </td>
                  <td style={{ padding: '1rem', color: '#fff', fontWeight: 'bold' }}>
                    {log.username}
                  </td>
                  <td style={{ padding: '1rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                    {log.userId}
                  </td>
                  <td style={{ padding: '1rem' }}>
                    <span style={{ 
                      padding: '4px 8px', 
                      borderRadius: '4px', 
                      fontSize: '12px',
                      fontWeight: 'bold',
                      backgroundColor: log.status === 'SUCCESS' ? 'rgba(0,255,0,0.1)' : 'rgba(255,0,0,0.1)',
                      color: log.status === 'SUCCESS' ? 'var(--success)' : '#ff4444'
                    }}>
                      {log.status}
                    </span>
                  </td>
                  <td style={{ padding: '1rem', color: 'var(--text-dim)' }}>
                    {log.reason || '-'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
