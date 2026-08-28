"use client";
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

type Group = {
  id: number;
  name: string;
  category: number; // 1: Airplane, 2: Helicopter, 3: Ground, 4: Ship, 5: Train
  coalition: number;
};

type Unit = {
  id: number;
  name: string;
  type: string;
  player_name?: string;
  coalition: number;
};

type StaticObj = {
  id: number;
  name: string;
  type: string;
  coalition: number;
  position: { lat?: number; lon?: number; alt?: number };
};

type CoalitionData = {
  bullseye: { lat: number; lon: number } | null;
  groups: Group[];
  players: Unit[];
  statics: StaticObj[];
};

export default function OrbatPage() {
  const [loading, setLoading] = useState(true);
  const [redData, setRedData] = useState<CoalitionData | null>(null);
  const [blueData, setBlueData] = useState<CoalitionData | null>(null);
  
  const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>({
    'red-players': true, 'blue-players': true,
    'red-air': true, 'blue-air': true,
    'red-ground': true, 'blue-ground': true,
  });

  const toggleCat = (key: string) => {
    setExpandedCats(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const loadData = async () => {
    try {
      // Helper to fetch all data for a coalition (2 = Red, 3 = Blue)
      const fetchCoalition = async (c: number): Promise<CoalitionData> => {
        // category 0 for all
        const [bullseyeRes, groupsRes, playersRes, staticsRes] = await Promise.all([
          apiFetch(`/api/coalition/bullseye?coalition=${c}`).then(r => r.json()),
          apiFetch(`/api/coalition/groups?coalition=${c}&category=0`).then(r => r.json()),
          apiFetch(`/api/coalition/players?coalition=${c}`).then(r => r.json()),
          apiFetch(`/api/coalition/statics?coalition=${c}`).then(r => r.json()),
        ]);
        
        return {
          bullseye: bullseyeRes.bullseye,
          groups: groupsRes.groups || [],
          players: playersRes.units || [],
          statics: staticsRes.statics || [],
        };
      };

      const [red, blue] = await Promise.all([fetchCoalition(2), fetchCoalition(3)]);
      setRedData(red);
      setBlueData(blue);
    } catch (e) {
      console.error("Failed to load ORBAT", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const initial = setTimeout(loadData, 0);
    return () => clearTimeout(initial);
  }, []);

  const renderSide = (sideName: string, color: string, data: CoalitionData | null, prefix: string) => {
    if (!data) return null;

    const airGroups = data.groups.filter(g => g.category === 1 || g.category === 2);
    const groundGroups = data.groups.filter(g => g.category === 3);
    const navalGroups = data.groups.filter(g => g.category === 4);

    const renderTree = <T,>(title: string, count: number, key: string, items: T[], renderItem: (item: T, idx: number) => React.ReactNode) => (
      <div style={{ marginBottom: '10px' }}>
        <div 
          onClick={() => toggleCat(key)}
          style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            background: 'var(--card-bg)', 
            padding: '8px 12px', 
            cursor: 'pointer',
            borderLeft: `3px solid ${color}`,
            userSelect: 'none'
          }}
        >
          <span style={{ fontWeight: 'bold' }}>{title}</span>
          <span>{expandedCats[key] ? '▼' : '▶'} ({count})</span>
        </div>
        {expandedCats[key] && (
          <div style={{ padding: '10px 0 10px 20px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
            {items.length === 0 ? (
              <span style={{ color: 'var(--text-muted)' }}>None</span>
            ) : (
              items.map(renderItem)
            )}
          </div>
        )}
      </div>
    );

    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '15px', backgroundColor: 'var(--panel-bg)', padding: '20px', borderRadius: '8px', border: '1px solid var(--panel-border)' }}>
        <h2 style={{ color, borderBottom: `1px solid ${color}`, paddingBottom: '10px' }}>
          {sideName}
          {data.bullseye && (
            <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginLeft: '15px', fontWeight: 'normal' }}>
              Bullseye: {data.bullseye.lat.toFixed(4)}, {data.bullseye.lon.toFixed(4)}
            </span>
          )}
        </h2>

        {renderTree("Players", data.players.length, `${prefix}-players`, data.players, (p, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ color: '#ffcc00', fontWeight: 'bold' }}>{p.player_name}</span>
            <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>in</span>
            <span style={{ color: 'var(--text-secondary)' }}>{p.type || p.name}</span>
          </div>
        ))}

        {renderTree("Air Groups", airGroups.length, `${prefix}-air`, airGroups, (g, i) => (
          <div key={i} style={{ color: 'var(--text-secondary)' }}>
            ✈️ {g.name}
          </div>
        ))}

        {renderTree("Ground Groups", groundGroups.length, `${prefix}-ground`, groundGroups, (g, i) => (
          <div key={i} style={{ color: 'var(--text-secondary)' }}>
            🛡️ {g.name}
          </div>
        ))}

        {renderTree("Naval Groups", navalGroups.length, `${prefix}-naval`, navalGroups, (g, i) => (
          <div key={i} style={{ color: 'var(--text-secondary)' }}>
            ⚓ {g.name}
          </div>
        ))}

        {renderTree("Static Objects", data.statics.length, `${prefix}-statics`, data.statics, (s, i) => (
          <div key={i} style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
            {s.name} ({s.type})
          </div>
        ))}
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h1>Order of Battle (ORBAT)</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Hierarchical view of all active forces by coalition.</p>
        </div>
        <button 
          onClick={loadData} 
          disabled={loading}
          style={{
            background: 'var(--primary)',
            color: '#000',
            border: 'none',
            padding: '8px 16px',
            borderRadius: '4px',
            cursor: loading ? 'not-allowed' : 'pointer',
            fontWeight: 'bold'
          }}
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: '40px', overflowY: 'auto', paddingRight: '10px' }}>
        {renderSide("BLUE TASK FORCE", "#00ccff", blueData, "blue")}
        {renderSide("RED TASK FORCE", "#ff4444", redData, "red")}
      </div>
    </div>
  );
}
