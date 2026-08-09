"use client";
import dynamic from 'next/dynamic';
import styles from '../page.module.css';

// Leaflet requires window object, so we must load it dynamically
const DynamicMap = dynamic(() => import('../../components/Map'), { 
  ssr: false,
  loading: () => (
    <div style={{ height: 'calc(100vh - 160px)', minHeight: '600px', width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', background: 'var(--card-bg)', border: '1px solid var(--panel-border)' }}>
      <p style={{ color: 'var(--primary)', fontFamily: 'var(--font-mono)' }}>Initializing Tactical Radar...</p>
    </div>
  )
});

export default function RadarPage() {
  return (
    <main className={styles.main}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--panel-border)', paddingBottom: '10px', marginBottom: '10px' }}>
        <h1 style={{ margin: 0, borderBottom: 'none', paddingBottom: 0 }}>Live Tactical Radar</h1>
        <span style={{ fontSize: '12px', padding: '4px 8px', background: 'rgba(57, 211, 83, 0.1)', border: '1px solid var(--success)', color: 'var(--success)', borderRadius: '2px', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>LIVE STREAM</span>
      </div>
      
      <p style={{ color: 'var(--text-muted)', fontSize: '14px', marginBottom: '10px' }}>
        Real-time telemetry of all tracked objects within the DCS theatre. 
        <span style={{ color: 'var(--danger)', marginLeft: '10px' }}>RED</span> = Opposing Force, 
        <span style={{ color: 'var(--primary)', marginLeft: '10px' }}>BLUE</span> = Coalition, 
        <span style={{ color: 'var(--text-muted)', marginLeft: '10px' }}>GREY</span> = Neutral.
      </p>

      <DynamicMap />
    </main>
  );
}
