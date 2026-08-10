import { useState } from 'react';
import { apiFetch } from '@/lib/api';

export default function UnitPopup({ unit }: { unit: any }) {
  const [details, setDetails] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'info' | 'ai'>('info');

  const loadDetails = async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/units/${encodeURIComponent(unit.name)}`);
      const data = await res.json();
      setDetails(data);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  const destroyUnit = async () => {
    if (!confirm('Are you sure you want to destroy this group?')) return;
    try {
      await apiFetch(`/api/units/${encodeURIComponent(unit.name)}/destroy`, { method: 'POST' });
      alert('Group destroyed');
    } catch(e) {
      console.error(e);
    }
  };

  const toggleRadar = async () => {
    if (!details) return;
    const nextState = !details.radar_active;
    try {
      await apiFetch(`/api/units/${encodeURIComponent(unit.name)}/emission`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emitting: nextState })
      });
      setDetails({ ...details, radar_active: nextState });
    } catch (e) {
      console.error(e);
    }
  };

  const setROE = async (roe: number) => {
    try {
      await apiFetch(`/api/units/${encodeURIComponent(unit.name)}/roe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roe })
      });
      alert('ROE updated for group.');
    } catch (e) {
      console.error(e);
    }
  };

  const setAlarmState = async (alarm_state: number) => {
    try {
      await apiFetch(`/api/units/${encodeURIComponent(unit.name)}/alarm-state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alarm_state })
      });
      alert('Alarm state updated for group.');
    } catch (e) {
      console.error(e);
    }
  };

  const playerName = unit.playerName || unit.player_name;
  const isPlayer = !!playerName && playerName.trim() !== '';

  return (
    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: '#000', width: '280px' }}>
      <strong>{unit.name}</strong><br/>
      {isPlayer && <span style={{ color: '#0056b3', fontWeight: 'bold' }}>👤 Player: {playerName}<br/></span>}
      Type: {unit.type}<br/>
      Alt: {Math.round(unit.position.alt)}m<br/>
      Speed: {Math.round((unit.velocity?.speed || 0) * 1.94384)} kts<br/>

      <div style={{ display: 'flex', gap: '5px', marginTop: '10px', borderBottom: '1px solid #ccc', paddingBottom: '5px' }}>
        <button 
          onClick={() => setActiveTab('info')} 
          style={{ padding: '2px 8px', cursor: 'pointer', background: activeTab === 'info' ? '#0056b3' : '#eee', color: activeTab === 'info' ? '#fff' : '#000', border: '1px solid #ccc', borderRadius: '4px' }}
        >
          Info
        </button>
        <button 
          onClick={() => setActiveTab('ai')} 
          style={{ padding: '2px 8px', cursor: 'pointer', background: activeTab === 'ai' ? '#0056b3' : '#eee', color: activeTab === 'ai' ? '#fff' : '#000', border: '1px solid #ccc', borderRadius: '4px' }}
        >
          AI Control
        </button>
      </div>

      <div style={{ marginTop: '10px', display: 'flex', gap: '5px', flexDirection: 'column' }}>
        {activeTab === 'info' && (
          <>
            {!details && <button onClick={loadDetails} disabled={loading} style={{ padding: '4px', cursor: 'pointer', border: '1px solid #ccc', borderRadius: '2px', background: '#fff' }}>{loading ? 'Loading...' : 'Deep Inspect'}</button>}
            {details && (
              <div style={{ background: '#eee', padding: '5px', borderRadius: '4px', border: '1px solid #ddd' }}>
                <strong>Health:</strong> {Math.round(details.life)} / {Math.round(details.life0)}<br/>
                <strong>Fuel:</strong> {(details.fuel * 100).toFixed(1)}%<br/>
                
                {details.radar_active !== undefined && (
                  <div style={{ marginTop: '5px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span><strong>Radar:</strong> {details.radar_active ? '🟢 ON' : '🔴 OFF'}</span>
                    <button onClick={toggleRadar} style={{ padding: '2px 6px', fontSize: '10px', cursor: 'pointer', borderRadius: '2px', border: '1px solid #ccc', background: '#fff' }}>
                      Toggle Emission
                    </button>
                  </div>
                )}

                {details.sensors && details.sensors.length > 0 && (
                  <div style={{ marginTop: '5px', borderTop: '1px solid #ccc', paddingTop: '5px' }}>
                    <strong>Sensors:</strong>
                    <ul style={{ margin: '2px 0 0 15px', padding: 0 }}>
                      {details.sensors.map((s: any, i: number) => (
                        <li key={i}>
                          {s.type_name}
                          {s.radar_head_on && <span> (Radar {Math.round(s.radar_head_on / 1852)}nm)</span>}
                          {s.irst_distance_maximal && <span> (IRST {Math.round(s.irst_distance_maximal / 1852)}nm)</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {details.weapons && details.weapons.length > 0 && (
                  <div style={{ marginTop: '5px', borderTop: '1px solid #ccc', paddingTop: '5px' }}>
                    <strong>Weapons:</strong>
                    <ul style={{ margin: '2px 0 0 15px', padding: 0 }}>
                      {details.weapons.map((w: any, i: number) => (
                        <li key={i}>{w.count}x {w.name}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
            <button onClick={destroyUnit} style={{ padding: '4px', background: '#dc3545', color: '#fff', border: 'none', borderRadius: '2px', cursor: 'pointer', marginTop: '5px' }}>Destroy Group</button>
          </>
        )}

        {activeTab === 'ai' && (
          <div style={{ background: '#eee', padding: '10px', borderRadius: '4px', border: '1px solid #ddd', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontWeight: 'bold' }}>Rules of Engagement:</label>
              <select onChange={(e) => setROE(parseInt(e.target.value))} defaultValue="" style={{ padding: '4px' }}>
                <option value="" disabled>Select ROE...</option>
                <option value="0">Weapon Free</option>
                <option value="1">Open Fire (Weapon Free)</option>
                <option value="2">Open Fire</option>
                <option value="3">Return Fire</option>
                <option value="4">Weapon Hold</option>
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontWeight: 'bold' }}>Alarm State:</label>
              <select onChange={(e) => setAlarmState(parseInt(e.target.value))} defaultValue="" style={{ padding: '4px' }}>
                <option value="" disabled>Select Alarm State...</option>
                <option value="1">Auto</option>
                <option value="2">Green (Radar Off)</option>
                <option value="3">Red (Combat Ready)</option>
              </select>
            </div>
            <p style={{ fontSize: '10px', color: '#666', marginTop: '5px', marginBottom: 0 }}>These commands apply to the entire group that this unit belongs to.</p>
          </div>
        )}
      </div>
    </div>
  );
}
