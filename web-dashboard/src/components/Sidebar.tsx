"use client";
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import styles from './Sidebar.module.css';

export default function Sidebar() {
  const pathname = usePathname();
  const [rdpStatus, setRdpStatus] = useState<{active: boolean, users: any[]} | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const fetchRdpStatus = async () => {
      try {
        const res = await apiFetch('/api/rdp-status');
        const data = await res.json();
        setRdpStatus(data);
      } catch (err) {
        console.error('Failed to fetch RDP status:', err);
      }
    };

    fetchRdpStatus();
    const interval = setInterval(fetchRdpStatus, 15000);
    return () => clearInterval(interval);
  }, []);

  // Auto-close sidebar on mobile when navigating
  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  return (
    <>
      {/* Mobile Header */}
      <div className={styles.mobileHeader}>
        <div className={styles.title} style={{ borderBottom: 'none', marginBottom: 0, padding: 0 }}>
          DCS ADMIN
        </div>
        
        {rdpStatus && (
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '6px', 
            marginRight: 'auto', 
            marginLeft: '15px',
            background: rdpStatus.active ? 'rgba(255, 68, 68, 0.1)' : 'rgba(0, 255, 0, 0.05)',
            border: `1px solid ${rdpStatus.active ? 'rgba(255, 68, 68, 0.3)' : 'rgba(0, 255, 0, 0.1)'}`,
            padding: '4px 8px',
            borderRadius: '4px'
          }}>
            <div style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: rdpStatus.active ? '#ff4444' : 'var(--success)',
              boxShadow: `0 0 8px ${rdpStatus.active ? '#ff4444' : 'var(--success)'}`
            }} />
            <span style={{ fontSize: '10px', fontWeight: 'bold', color: rdpStatus.active ? '#ff4444' : 'var(--success)', fontFamily: 'var(--font-mono)', letterSpacing: '1px' }}>
              {rdpStatus.active ? 'RDP IN USE' : 'RDP FREE'}
            </span>
          </div>
        )}

        <button className={styles.hamburger} onClick={() => setIsOpen(!isOpen)}>
          ☰
        </button>
      </div>

      {/* Main Sidebar */}
      <nav className={`${styles.sidebar} ${isOpen ? styles.sidebarOpen : ''}`}>
        <div className={`${styles.title} ${styles.desktopTitle}`}>DCS Server Management</div>

        {rdpStatus && (
          <div style={{
            padding: '12px 15px',
            marginBottom: '15px',
            borderRadius: '6px',
            backgroundColor: rdpStatus.active ? 'rgba(255, 68, 68, 0.1)' : 'rgba(0, 255, 0, 0.05)',
            border: `1px solid ${rdpStatus.active ? 'rgba(255, 68, 68, 0.3)' : 'rgba(0, 255, 0, 0.1)'}`,
            display: 'flex',
            flexDirection: 'column',
            gap: '5px',
            flexShrink: 0
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: rdpStatus.active ? '#ff4444' : 'var(--success)',
                boxShadow: `0 0 8px ${rdpStatus.active ? '#ff4444' : 'var(--success)'}`
              }} />
              <span style={{ fontSize: '12px', fontWeight: 'bold', color: rdpStatus.active ? '#ff4444' : 'var(--success)', fontFamily: 'var(--font-mono)' }}>
                {rdpStatus.active ? 'RDP OCCUPIED' : 'RDP AVAILABLE'}
              </span>
            </div>
            {rdpStatus.active && rdpStatus.users.length > 0 && (
              <div style={{ fontSize: '11px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                Users: {rdpStatus.users.map(u => u.username).join(', ')}
              </div>
            )}
          </div>
        )}

        <div className={styles.nav} style={{ flex: 1, overflowY: 'auto' }}>
          <Link href="/" className={`${styles.link} ${pathname === '/' ? styles.active : ''}`}>Server Status</Link>
          <Link href="/mission" className={`${styles.link} ${pathname === '/mission' ? styles.active : ''}`}>Mission</Link>
          <Link href="/weather" className={`${styles.link} ${pathname === '/weather' ? styles.active : ''}`}>Weather</Link>
          <Link href="/radar" className={`${styles.link} ${pathname === '/radar' ? styles.active : ''}`}>Radar</Link>
          <Link href="/events" className={`${styles.link} ${pathname === '/events' ? styles.active : ''}`}>Events</Link>
          <Link href="/triggers" className={`${styles.link} ${pathname === '/triggers' ? styles.active : ''}`}>Triggers</Link>
          <Link href="/srs" className={`${styles.link} ${pathname === '/srs' ? styles.active : ''}`}>SRS</Link>
          <Link href="/console" className={`${styles.link} ${pathname === '/console' ? styles.active : ''}`}>Console</Link>
          <Link href="/atmosphere" className={`${styles.link} ${pathname === '/atmosphere' ? styles.active : ''}`}>Atmosphere</Link>
          <Link href="/players" className={`${styles.link} ${pathname === '/players' ? styles.active : ''}`}>Players</Link>
          <Link href="/chat" className={`${styles.link} ${pathname === '/chat' ? styles.active : ''}`}>Chat</Link>
          <Link href="/leaderboard" className={`${styles.link} ${pathname === '/leaderboard' ? styles.active : ''}`}>Leaderboard</Link>
          <Link href="/settings" className={`${styles.link} ${pathname === '/settings' ? styles.active : ''}`}>Settings</Link>
          <Link href="/access-logs" className={`${styles.link} ${pathname === '/access-logs' ? styles.active : ''}`}>Access Logs</Link>
          <Link href="/foothold" className={`${styles.link} ${pathname === '/foothold' ? styles.active : ''}`}>Foothold</Link>
          <Link href="/logs/dcs" className={`${styles.link} ${pathname === '/logs/dcs' ? styles.active : ''}`}>DCS Logs</Link>
          <Link href="/tasks" className={`${styles.link} ${pathname === '/tasks' ? styles.active : ''}`}>Tasks</Link>
        </div>
      </nav>
      
      {/* Mobile Overlay (Click to close) */}
      {isOpen && (
        <div 
          onClick={() => setIsOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 998
          }}
          className="mobileOnlyOverlay"
        />
      )}
    </>
  );
}
