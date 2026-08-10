"use client";
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

export default function ServerPerformance() {
  const [fps, setFps] = useState<number | null>(null);
  const [ballistics, setBallistics] = useState<number>(0);
  const [timeRatio, setTimeRatio] = useState<number>(1.0);
  
  // Previous times for ratio calculation
  const [prevModelTime, setPrevModelTime] = useState<number | null>(null);
  const [prevRealTime, setPrevRealTime] = useState<number | null>(null);

  // Subscribe to FPS events
  useEffect(() => {
    const source = new EventSource('/api/events/stream');
    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.simulation_fps) {
          setFps(Math.round(data.simulation_fps.average));
        }
      } catch (err) {
        // ignore
      }
    };
    return () => {
      source.close();
    };
  }, []);

  // Poll for performance stats
  useEffect(() => {
    const fetchPerf = async () => {
      try {
        const res = await apiFetch('/api/performance');
        const data = await res.json();
        
        if (data.ballistics_count !== undefined) {
          setBallistics(data.ballistics_count);
        }

        if (data.model_time !== undefined && data.real_time !== undefined) {
          if (prevModelTime !== null && prevRealTime !== null) {
            const modelDiff = data.model_time - prevModelTime;
            const realDiff = data.real_time - prevRealTime;
            if (realDiff > 0) {
              setTimeRatio(modelDiff / realDiff);
            }
          }
          setPrevModelTime(data.model_time);
          setPrevRealTime(data.real_time);
        }
      } catch (err) {
        // ignore
      }
    };

    const intervalId = setInterval(fetchPerf, 3000);
    return () => clearInterval(intervalId);
  }, [prevModelTime, prevRealTime]);

  const getFpsColor = () => {
    if (fps === null) return 'var(--text-secondary)';
    if (fps > 30) return '#00ff88';
    if (fps > 15) return '#ffaa00';
    return '#ff4444';
  };

  const getRatioColor = () => {
    if (timeRatio >= 0.95) return '#00ff88';
    if (timeRatio >= 0.75) return '#ffaa00';
    return '#ff4444';
  };

  return (
    <div style={{
      marginTop: 'auto',
      padding: '1rem',
      borderTop: '1px solid var(--border)',
      background: 'var(--surface-light)',
      borderRadius: '8px',
      margin: '1rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.75rem',
      fontSize: '0.9rem'
    }}>
      <div style={{ color: 'var(--text-secondary)', fontWeight: 'bold', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '1px' }}>
        Live Performance
      </div>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: 'var(--text-secondary)' }}>Server FPS</span>
        <strong style={{ color: getFpsColor() }}>{fps !== null ? fps : '--'}</strong>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: 'var(--text-secondary)' }}>Time Ratio</span>
        <strong style={{ color: getRatioColor() }}>{timeRatio.toFixed(2)}x</strong>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: 'var(--text-secondary)' }}>Active Ballistics</span>
        <strong>{ballistics}</strong>
      </div>
    </div>
  );
}
