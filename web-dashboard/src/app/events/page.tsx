"use client";
import { useEffect, useState, useRef } from 'react';

export default function EventsPage() {
  const [events, setEvents] = useState<any[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const source = new EventSource('/api/events/stream');
    
    source.onmessage = (event) => {
      const data = JSON.parse(event.data);
      // Keep only last 150 events in memory
      setEvents(prev => [...prev, data].slice(-150));
    };
    
    return () => {
      source.close();
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events]);

  const renderEvent = (data: any) => {
    if (data.shot) {
      return <span><strong style={{ color: 'var(--primary)' }}>{data.shot.initiator?.name || 'Unknown'}</strong> fired <strong>{data.shot.weapon?.name || 'Weapon'}</strong></span>;
    }
    if (data.hit) {
      return <span><strong style={{ color: 'var(--primary)' }}>{data.hit.target?.name || 'Unknown'}</strong> was hit by <strong>{data.hit.weapon?.name || data.hit.weapon_name || 'Weapon'}</strong></span>;
    }
    if (data.kill) {
      return <span><strong style={{ color: '#ff4444' }}>{data.kill.target?.name || 'Unknown'}</strong> was KILLED by <strong style={{ color: 'var(--primary)' }}>{data.kill.initiator?.name || 'Unknown'}</strong> ({data.kill.weapon?.name || data.kill.weapon_name || 'Weapon'})</span>;
    }
    if (data.takeoff) {
      return <span><strong style={{ color: 'var(--primary)' }}>{data.takeoff.initiator?.name || 'Unknown'}</strong> took off from <strong>{data.takeoff.place?.name || 'Airbase'}</strong></span>;
    }
    if (data.land) {
      return <span><strong style={{ color: 'var(--primary)' }}>{data.land.initiator?.name || 'Unknown'}</strong> landed at <strong>{data.land.place?.name || 'Airbase'}</strong></span>;
    }
    if (data.crash) {
      return <span><strong style={{ color: '#ff4444' }}>{data.crash.initiator?.name || 'Unknown'}</strong> CRASHED!</span>;
    }
    if (data.ejection) {
      return <span><strong style={{ color: '#ffaa00' }}>{data.ejection.initiator?.name || 'Unknown'}</strong> EJECTED!</span>;
    }
    if (data.player_enter_unit) {
      return <span><strong style={{ color: '#00ccff' }}>{data.player_enter_unit.initiator?.playerName || 'Player'}</strong> entered <strong>{data.player_enter_unit.initiator?.name || 'Unit'}</strong></span>;
    }
    if (data.player_leave_unit) {
      return <span><strong style={{ color: '#00ccff' }}>{data.player_leave_unit.initiator?.playerName || 'Player'}</strong> left unit</span>;
    }
    if (data.player_send_chat) {
      return <span>[CHAT] <strong style={{ color: '#00ccff' }}>{data.player_send_chat.playerName || 'Player'}</strong>: {data.player_send_chat.message}</span>;
    }
    if (data.connect) {
      return <span><strong style={{ color: '#00ccff' }}>{data.connect.name}</strong> connected to the server.</span>;
    }
    if (data.disconnect) {
      return <span><strong style={{ color: '#00ccff' }}>Player ID {data.disconnect.id}</strong> disconnected.</span>;
    }
    if (data.mission_start) return <span><strong style={{ color: '#00ff88' }}>MISSION STARTED</strong></span>;
    if (data.mission_end) return <span><strong style={{ color: '#ff4444' }}>MISSION ENDED</strong></span>;
    
    // Find the event key that was populated (skip time)
    const key = Object.keys(data).find(k => k !== 'time');
    return <span style={{ opacity: 0.5 }}>{key ? `[${key.toUpperCase()}] Event` : 'Unknown event'}</span>;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', maxHeight: 'calc(100vh - 4rem)' }}>
      <h1>Server Event Feed</h1>
      <p style={{ color: 'var(--text-secondary)' }}>Live streaming killfeed and mission events directly from DCS World.</p>
      
      <div style={{ 
        flex: 1, 
        backgroundColor: '#0b1118', 
        border: '1px solid var(--panel-border)', 
        borderRadius: '4px',
        padding: '1rem',
        overflowY: 'auto',
        fontFamily: 'var(--font-mono)',
        fontSize: '13px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px'
      }}>
        {events.length === 0 ? (
          <div style={{ color: 'var(--primary)', opacity: 0.7 }}>Waiting for events...</div>
        ) : (
          events.map((e, i) => {
            const timeInSec = Math.floor(e.time || 0);
            const h = Math.floor(timeInSec / 3600).toString().padStart(2, '0');
            const m = Math.floor((timeInSec % 3600) / 60).toString().padStart(2, '0');
            const s = Math.floor(timeInSec % 60).toString().padStart(2, '0');
            const timeStr = `${h}:${m}:${s}`;

            return (
              <div key={i} style={{ display: 'flex', gap: '1rem' }}>
                <span style={{ color: 'var(--text-secondary)', minWidth: '70px', fontWeight: 'bold' }}>
                  {timeStr}
                </span>
                <div style={{ flex: 1, color: '#e0e0e0' }}>
                  {renderEvent(e)}
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
