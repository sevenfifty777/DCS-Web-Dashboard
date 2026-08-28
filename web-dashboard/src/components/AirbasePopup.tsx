import { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api';

interface Airbase {
  name?: string;
  display_name?: string;
  callsign?: string;
  category?: number;
  coalition: string;
}

interface Runway {
  name: string;
  course: number;
  length: number;
  width: number;
}

export default function AirbasePopup({ base }: { base: Airbase }) {
  const [runways, setRunways] = useState<Runway[]>([]);
  const [parking, setParking] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(true);
  const [coalition, setCoalition] = useState<string>(base.coalition);
  const [changing, setChanging] = useState(false);

  useEffect(() => {
    let mounted = true;
    
    // Only fetch for actual airbases (not FARPs or Ships typically, but we can try)
    // Actually WorldService.GetAirbaseParking uses `name`.
    const fetchDetails = async () => {
      if (!base.name) {
        setLoading(false);
        return;
      }
      
      try {
        const [rRes, pRes] = await Promise.all([
          apiFetch(`/api/world/airbases/${encodeURIComponent(base.name)}/runways`),
          apiFetch(`/api/world/airbases/${encodeURIComponent(base.name)}/parking?available=true`),
        ]);
        
        if (mounted) {
          if (rRes.ok) {
            const rData = await rRes.json();
            setRunways(rData.runways || []);
          }
          if (pRes.ok) {
            const pData = await pRes.json();
            setParking(pData.parking || []);
          }
          setLoading(false);
        }
      } catch (err) {
        console.error("Failed to fetch airbase details", err);
        if (mounted) setLoading(false);
      }
    };
    
    fetchDetails();
    return () => { mounted = false; };
  }, [base.name]);

  const handleChangeCoalition = async (newCoalition: number) => {
    if (!base.name) return;
    setChanging(true);
    try {
      const res = await apiFetch(`/api/world/airbases/${encodeURIComponent(base.name)}/coalition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coalition: newCoalition })
      });
      if (res.ok) {
        // Optimistically update local UI state. The map marker color will update on next polling cycle.
        const cMap = { 0: 'COALITION_NEUTRAL', 1: 'COALITION_NEUTRAL', 2: 'COALITION_RED', 3: 'COALITION_BLUE' };
        setCoalition(cMap[newCoalition as keyof typeof cMap]);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setChanging(false);
    }
  };

  return (
    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: '#333', minWidth: '220px' }}>
      <div style={{ marginBottom: '8px', paddingBottom: '8px', borderBottom: '1px solid #ccc' }}>
        <strong style={{ fontSize: '14px' }}>{base.display_name || base.name || base.callsign || 'Unknown Airbase'}</strong><br/>
        Type: {base.category === 2 ? 'FARP / Helipad' : base.category === 3 ? 'Carrier / Ship' : 'Airbase'}
      </div>

      <div style={{ marginBottom: '10px' }}>
        <strong>Coalition:</strong> 
        <select 
          value={coalition === 'COALITION_RED' ? 2 : coalition === 'COALITION_BLUE' ? 3 : 0} 
          disabled={changing}
          onChange={(e) => handleChangeCoalition(Number(e.target.value))}
          style={{ marginLeft: '10px', padding: '2px', fontSize: '11px' }}
        >
          <option value={0}>Neutral</option>
          <option value={2}>Red</option>
          <option value={3}>Blue</option>
        </select>
        {changing && <span style={{ marginLeft: '5px' }}>...</span>}
      </div>

      {loading ? (
        <div style={{ color: '#666', fontStyle: 'italic' }}>Loading details...</div>
      ) : (
        <>
          <div style={{ marginBottom: '10px' }}>
            <strong>Runways:</strong>
            {runways.length === 0 ? <span style={{ color: '#888', marginLeft: '5px' }}>None</span> : (
              <ul style={{ margin: '4px 0 0 15px', padding: 0 }}>
                {runways.map((r, i) => (
                  <li key={i}>{r.name} - hdg {Math.round(r.course * (180/Math.PI))}° ({Math.round(r.length)}m x {Math.round(r.width)}m)</li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <strong>Available Parking:</strong> {parking.length > 0 ? parking.length : <span style={{ color: '#888' }}>None</span>}
          </div>
        </>
      )}
    </div>
  );
}
