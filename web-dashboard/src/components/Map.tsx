"use client";
import { useEffect, useState, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, LayersControl, Circle, Polygon, Polyline, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { apiFetch } from '@/lib/api';
import UnitPopup from './UnitPopup';
import AirbasePopup from './AirbasePopup';
import MapToolbar from './MapToolbar';

// Fix for default Leaflet icons in Next.js
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

const iconCache: Record<string, L.DivIcon> = {};

const getIcon = (color: string, category: string, isPlayer: boolean = false) => {
  const key = `${color}-${category}-${isPlayer}`;
  if (iconCache[key]) return iconCache[key];

  let svg = '';
  const strokeColor = isPlayer ? '#ffd700' : 'white'; // Gold border for players
  const strokeWidth = isPlayer ? '2.5' : '1.5';
  const size = isPlayer ? 22 : 18; // Make player icons slightly larger
  const offset = size / 2;

  if (category === 'GROUP_CATEGORY_AIRPLANE') {
    svg = `<svg width="${size}" height="${size}" viewBox="0 0 16 16" style="transform: rotate(0deg);"><path d="M8 1L15 15H1z" fill="${color}" stroke="${strokeColor}" stroke-width="${strokeWidth}"/></svg>`;
  } else if (category === 'GROUP_CATEGORY_HELICOPTER') {
    svg = `<svg width="${size}" height="${size}" viewBox="0 0 16 16"><path d="M1 3h14v2H1zM4 5h8v7L8 15z" fill="${color}" stroke="${strokeColor}" stroke-width="${strokeWidth === '1.5' ? '1' : '1.5'}"/></svg>`;
  } else if (category === 'GROUP_CATEGORY_SHIP') {
    svg = `<svg width="${size}" height="${size}" viewBox="0 0 16 16"><path d="M8 1L15 8L8 15L1 8z" fill="${color}" stroke="${strokeColor}" stroke-width="${strokeWidth}"/></svg>`;
  } else if (category === 'GROUP_CATEGORY_GROUND') {
    svg = `<svg width="${size}" height="${size}" viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" fill="${color}" stroke="${strokeColor}" stroke-width="${strokeWidth}"/></svg>`;
  } else {
    svg = `<svg width="${size}" height="${size}" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="${color}" stroke="${strokeColor}" stroke-width="${strokeWidth}"/></svg>`;
  }

  const icon = new L.DivIcon({
    className: 'custom-div-icon',
    html: `<div style="filter: drop-shadow(0 0 ${isPlayer ? '6px' : '4px'} ${isPlayer ? strokeColor : color}); display:flex; justify-content:center; align-items:center;">${svg}</div>`,
    iconSize: [size, size],
    iconAnchor: [offset, offset]
  });

  iconCache[key] = icon;
  return icon;
};

const parsePathOptions = (colorArr: number[], isDrawing: boolean = false) => {
  const baseOpts: any = { color: 'white', fillColor: 'white', fillOpacity: 0.15, weight: 2 };
  if (isDrawing) baseOpts.className = 'pointer-events-none';
  if (!colorArr || colorArr.length < 4) return baseOpts;
  
  const r = Math.round(colorArr[0] * 255);
  const g = Math.round(colorArr[1] * 255);
  const b = Math.round(colorArr[2] * 255);
  const a = colorArr[3];
  
  return {
    color: `rgba(${r}, ${g}, ${b}, ${Math.min(1, a * 2.0)})`,
    fillColor: `rgb(${r}, ${g}, ${b})`,
    fillOpacity: a,
    weight: 2,
    className: isDrawing ? 'pointer-events-none' : ''
  };
};

const DrawingEvents = ({ drawingMode, setDrawingMode, drawingStart, setDrawingStart, setMyMarks, refreshMarks, markText, smokeColor, jtacMode, setJtacMode, setActiveLasers }: any) => {
  useMapEvents({
    click: async (e) => {
      if (!drawingMode) return;
      const { lat, lng } = e.latlng;
      
      if (drawingMode === 'jtac_lase' || drawingMode === 'jtac_ir') {
        if (!jtacMode) return;
        const payload = { target_x: lat, target_z: lng, code: jtacMode.code };
        try {
          const endpoint = drawingMode === 'jtac_lase' ? 'lase' : 'ir-point';
          const res = await apiFetch(`/api/units/${encodeURIComponent(jtacMode.unitName)}/${endpoint}`, { 
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) 
          });
          const data = await res.json();
          if (data.spot_id) {
            setActiveLasers((prev: any) => [...prev, { id: data.spot_id, sourceUnit: jtacMode.unitName, target: {lat, lng}, type: drawingMode }]);
          }
        } catch(err) { console.error(err); }
        setDrawingMode(null);
        setJtacMode(null);
        return;
      }

      if (drawingMode === 'smoke') {
        try {
          await apiFetch('/api/trigger/effects', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ effect: 'smoke', lat, lon: lng, color: smokeColor })
          });
          setDrawingMode(null);
        } catch(err) { console.error(err); }
        return;
      }

      if (drawingMode === 'mark' || drawingMode === 'circle') {
         const payload = { shape: drawingMode, lat1: lat, lon1: lng, r: 1.0, g: 0.0, b: 0.0, a: 1.0, radius: 2000.0, text: markText };
         try {
           const res = await apiFetch('/api/trigger/marks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
           const data = await res.json();
           if (data.id) setMyMarks((prev: any) => [...prev, data.id]);
           setDrawingMode(null);
           refreshMarks();
         } catch(err) { console.error(err); }
         return;
      }

      if (drawingMode === 'line' || drawingMode === 'rect') {
        if (!drawingStart) {
          setDrawingStart({ lat, lon: lng });
        } else {
          const payload = { shape: drawingMode, lat1: drawingStart.lat, lon1: drawingStart.lon, lat2: lat, lon2: lng, r: 1.0, g: 0.0, b: 0.0, a: 1.0 };
          try {
            const res = await apiFetch('/api/trigger/marks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            const data = await res.json();
            if (data.id) setMyMarks((prev: any) => [...prev, data.id]);
            refreshMarks();
          } catch(err) { console.error(err); }
          setDrawingStart(null);
          setDrawingMode(null);
        }
      }
    }
  });
  return null;
};

export default function Map() {

  const [units, setUnits] = useState<Record<string, any>>({});
  const [marks, setMarks] = useState<any[]>([]);
  const [airbases, setAirbases] = useState<any[]>([]);
  const [zones, setZones] = useState<any[]>([]);
  
  const [zoneMode, setZoneMode] = useState<'generic' | 'foothold' | 'graveyard'>('generic');
  const [wrecks, setWrecks] = useState<any[]>([]);
  
  const [showCombatEvents, setShowCombatEvents] = useState(false);
  const [liveEvents, setLiveEvents] = useState<any[]>([]);

  // Drawing state
  const [drawingMode, setDrawingMode] = useState<string | null>(null);
  const [drawingStart, setDrawingStart] = useState<{lat: number, lon: number} | null>(null);
  const [myMarks, setMyMarks] = useState<number[]>([]);
  const [markText, setMarkText] = useState('Dashboard Mark');
  const [smokeColor, setSmokeColor] = useState(2);
  const [jtacMode, setJtacMode] = useState<{ unitName: string, type: 'lase' | 'ir', code?: number } | null>(null);
  const [activeLasers, setActiveLasers] = useState<any[]>([]);
  
  useEffect(() => {
    if (zoneMode === 'graveyard') {
      setZones([]);
      return;
    }
    apiFetch(zoneMode === 'foothold' ? '/api/zones/foothold' : '/api/zones')
      .then(res => res.json())
      .then(data => {
        if (data.zones && Array.isArray(data.zones)) {
          setZones(data.zones);
        } else {
          setZones([]);
        }
      })
      .catch(err => {
        console.error('Failed to fetch zones', err);
        setZones([]);
      });
  }, [zoneMode]);

  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    const fetchGraveyard = () => {
      apiFetch('/api/graveyard')
        .then(res => res.json())
        .then(data => {
          if (data && Array.isArray(data.wrecks)) {
            setWrecks(data.wrecks);
          }
        })
        .catch(err => console.error('Failed to fetch graveyard', err));
    };

    if (zoneMode === 'graveyard') {
      fetchGraveyard();
      interval = setInterval(fetchGraveyard, 5000); // Poll every 5s for live updates
    } else {
      setWrecks([]);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [zoneMode]);

  const refreshMarks = () => {
    apiFetch('/api/marks')
      .then(res => res.json())
      .then(data => {
        if (data.marks) {
          setMarks(data.marks);
        }
      })
      .catch(err => console.error('Failed to fetch marks', err));
  };

  useEffect(() => {
    refreshMarks();

    apiFetch('/api/airbases')
      .then(res => res.json())
      .then(data => {
        if (data.airbases) {
          setAirbases(data.airbases);
        }
      })
      .catch(err => console.error('Failed to fetch airbases', err));


    const source = new EventSource('/api/radar/stream');
    
    source.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.update === 'unit' && data.unit) {
        setUnits(prev => ({
          ...prev,
          [data.unit.id]: data.unit
        }));
      } else if (data.update === 'gone' && data.gone) {
        setUnits(prev => {
          const newUnits = { ...prev };
          delete newUnits[data.gone.id];
          return newUnits;
        });
      }
    };
    
    return () => {
      source.close();
    };
  }, []);


  return (
    <div style={{ position: 'relative', height: 'calc(100vh - 160px)', minHeight: '600px', width: '100%', borderRadius: '4px', overflow: 'hidden', border: '1px solid var(--panel-border)', zIndex: 0 }}>
      <style>{`
        .pointer-events-none { pointer-events: none !important; }
      `}</style>
      <MapToolbar 
        drawingMode={drawingMode} 
        setDrawingMode={(m) => { setDrawingMode(m); setDrawingStart(null); }} 
        myMarks={myMarks} 
        setMyMarks={setMyMarks}
        markText={markText}
        setMarkText={setMarkText}
        smokeColor={smokeColor}
        setSmokeColor={setSmokeColor}
      />

      <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 1000, backgroundColor: 'rgba(0,0,0,0.7)', padding: '8px', borderRadius: '4px', display: 'flex', gap: '8px', alignItems: 'center' }}>
        <span style={{ color: 'white', fontSize: '14px', fontFamily: 'var(--font-mono)' }}>Zones:</span>
        <select 
          value={zoneMode} 
          onChange={(e) => setZoneMode(e.target.value as 'generic' | 'foothold' | 'graveyard')}
          style={{ backgroundColor: '#222', color: 'white', border: '1px solid #444', borderRadius: '4px', padding: '4px 8px', fontSize: '14px', fontFamily: 'var(--font-mono)', cursor: 'pointer' }}
        >
          <option value="generic">Generic (All)</option>
          <option value="foothold">Foothold (Frontline)</option>
          <option value="graveyard">Graveyard Heatmap</option>
        </select>
      </div>
      {/* Starting map at roughly Caucasus region, users can pan/zoom */}
      <MapContainer center={[42.0, 42.0]} zoom={6} style={{ height: '100%', width: '100%', backgroundColor: '#0b1118', zIndex: 0 }}>
        
        <DrawingEvents 
          drawingMode={drawingMode}
          setDrawingMode={setDrawingMode}
          drawingStart={drawingStart}
          setDrawingStart={setDrawingStart}
          setMyMarks={setMyMarks}
          refreshMarks={refreshMarks}
          markText={markText}
          smokeColor={smokeColor}
          jtacMode={jtacMode}
          setJtacMode={setJtacMode}
          setActiveLasers={setActiveLasers}
        />

        <LayersControl position="bottomleft">
          <LayersControl.BaseLayer checked name="CARTO Dark">
            <TileLayer
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              attribution='&copy; OpenStreetMap contributors &copy; CARTO'
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="ArcGIS Satellite">
            <TileLayer
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              attribution="Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community"
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="OpenStreetMap">
            <TileLayer
              url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; OpenStreetMap contributors'
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="OpenTopoMap">
            <TileLayer
              url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png"
              attribution='Map data: &copy; OpenStreetMap contributors, SRTM | Map style: &copy; OpenTopoMap (CC-BY-SA)'
            />
          </LayersControl.BaseLayer>
        </LayersControl>

        {Array.isArray(zones) && zones.map((zone, idx) => {
          if (!zone || !zone.lat || !zone.lon) return null;
          
          let pathOptions: any = { color: 'white', fillColor: 'white', fillOpacity: 0.15, weight: 2, className: drawingMode ? 'pointer-events-none' : '' };
          if (zoneMode === 'foothold') {
            let color = '#6c757d';
            let fillColor = '#6c757d';
            if (zone.side === 1) { color = '#dc3545'; fillColor = '#dc3545'; }
            if (zone.side === 2) { color = '#0d6efd'; fillColor = '#0d6efd'; }
            pathOptions = {
              color,
              fillColor,
              fillOpacity: Math.min(0.8, 0.15 + ((zone.level || 1) * 0.1)),
              weight: 2,
              className: drawingMode ? 'pointer-events-none' : ''
            };
          } else {
            if (zone.hidden) return null;
            pathOptions = parsePathOptions(zone.color, !drawingMode);
          }
          
          if (zone.type === 0 && zone.radius) {
            return (
              <Circle key={`zone-${idx}`} center={[zone.lat, zone.lon]} radius={zone.radius} pathOptions={pathOptions}>
                <Popup>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: '#000' }}>
                    <strong>{zone.name || 'Zone'}</strong><br/>
                    {zoneMode === 'foothold' && (
                      <>Side: {zone.side === 1 ? 'Red' : zone.side === 2 ? 'Blue' : 'Neutral'}<br/>Level: {zone.level}<br/></>
                    )}
                    Type: Circle<br/>
                    Radius: {Math.round(zone.radius)}m
                  </div>
                </Popup>
              </Circle>
            );
          } else if (zone.type === 2 && zone.verticies && zone.verticies.length > 0) {
            const positions = zone.verticies.map((v: any) => [v.lat, v.lon]);
            return (
              <Polygon key={`zone-${idx}`} positions={positions as any} pathOptions={pathOptions}>
                <Popup>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: '#000' }}>
                    <strong>{zone.name || 'Zone'}</strong><br/>
                    {zoneMode === 'foothold' && (
                      <>Side: {zone.side === 1 ? 'Red' : zone.side === 2 ? 'Blue' : 'Neutral'}<br/>Level: {zone.level}<br/></>
                    )}
                    Type: Polygon
                  </div>
                </Popup>
              </Polygon>
            );
          }
          return null;
        })}

        {Object.values(units).map((unit) => {
          if (!unit.position || !unit.position.lat || !unit.position.lon) return null;
          
          let color = 'var(--text-muted)';
          if (unit.coalition === 'COALITION_RED') color = 'var(--danger)';
          else if (unit.coalition === 'COALITION_BLUE') color = 'var(--primary)';

          const category = unit.group?.category || 'UNKNOWN';
          const playerName = unit.playerName || unit.player_name;
          const isPlayer = !!playerName && playerName.trim() !== '';
          const icon = getIcon(color, category, isPlayer);

          return (
            <Marker key={unit.id} position={[unit.position.lat, unit.position.lon]} icon={icon}>
              <Popup>
                <UnitPopup 
                  unit={unit} 
                  onStartLase={(unitName, code) => {
                    setJtacMode({ unitName, type: 'lase', code });
                    setDrawingMode('jtac_lase');
                    document.body.click(); // close popup hack
                  }}
                  onStartIR={(unitName) => {
                    setJtacMode({ unitName, type: 'ir' });
                    setDrawingMode('jtac_ir');
                    document.body.click(); // close popup hack
                  }}
                />
              </Popup>
            </Marker>
          );
        })}

        {activeLasers.map((laser, i) => {
          const unit = units[laser.sourceUnit];
          if (!unit) return null;
          const isIR = laser.type === 'jtac_ir';
          const color = isIR ? '#28a745' : '#dc3545';
          return (
            <Polyline 
              key={`laser-${i}`}
              positions={[
                [unit.position.lat, unit.position.lon],
                [laser.target.lat, laser.target.lng]
              ]}
              pathOptions={{
                color: color,
                weight: 2,
                dashArray: isIR ? '10, 10' : '5, 5',
                opacity: 0.8
              }}
            >
              <Popup>
                <strong>{isIR ? 'IR Pointer' : 'Laser'}</strong><br/>
                Source: {laser.sourceUnit}<br/>
                <button 
                  onClick={async () => {
                    try {
                      await apiFetch(`/api/spots/${laser.id}`, { method: 'DELETE' });
                      setActiveLasers(prev => prev.filter(l => l.id !== laser.id));
                    } catch(e) { console.error(e); }
                  }}
                  style={{ padding: '2px 6px', marginTop: '5px', background: '#dc3545', color: '#fff', border: 'none', borderRadius: '2px', cursor: 'pointer' }}
                >
                  Turn Off
                </button>
              </Popup>
            </Polyline>
          );
        })}

        {wrecks.map((wreck) => {
          let bgColor = 'rgba(80, 80, 80, 0.7)';
          if (wreck.coalition === 1) bgColor = 'rgba(220, 53, 69, 0.7)'; // RED
          else if (wreck.coalition === 2) bgColor = 'rgba(13, 110, 253, 0.7)'; // BLUE

          const wreckIcon = new L.DivIcon({
            className: 'custom-wreck-icon',
            html: `<div style="background-color: ${bgColor}; width: 14px; height: 14px; display: flex; align-items: center; justify-content: center; font-size: 10px; color: white; border-radius: 2px; border: 1px solid rgba(255,255,255,0.5);">☠</div>`,
            iconSize: [14, 14] as any,
            iconAnchor: [7, 7] as any
          });

          return (
            <Marker key={`wreck-${wreck.id}-${wreck.time}`} position={[wreck.lat, wreck.lon]} icon={wreckIcon}>
              <Popup>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: '#000' }}>
                  <strong>Destroyed Unit</strong><br/>
                  Type: {wreck.unit_type}<br/>
                  Coalition: {wreck.coalition === 1 ? 'Red' : wreck.coalition === 2 ? 'Blue' : 'Neutral'}<br/>
                  Time: {Math.round(wreck.time)}s
                </div>
              </Popup>
            </Marker>
          );
        })}

        {marks.filter(mark => {
          const text = (mark.text || '').trim();
          const lowerText = text.toLowerCase();
          return text !== '' && lowerText !== 'mark' && !lowerText.includes('downed');
        }).map((mark) => {
          if (!mark.position || !mark.position.lat || !mark.position.lon) return null;
          
          let bgColor = 'rgba(40, 40, 40, 0.8)';
          if (mark.coalition === 'COALITION_RED') bgColor = 'rgba(220, 53, 69, 0.8)';
          else if (mark.coalition === 'COALITION_BLUE') bgColor = 'rgba(13, 110, 253, 0.8)';

          const markIcon = new L.DivIcon({
            className: 'custom-mark-icon',
            html: `<div style="background-color: ${bgColor}; color: white; padding: 2px 6px; border-radius: 4px; font-size: 12px; font-family: monospace; white-space: nowrap; border: 1px solid rgba(255,255,255,0.3); box-shadow: 0 2px 4px rgba(0,0,0,0.5);">
              ${mark.text || 'Mark'}
            </div>`,
            iconSize: [0, 0] as any,
            iconAnchor: [0, 0]
          });

          return (
            <Marker key={`mark-${mark.id}`} position={[mark.position.lat, mark.position.lon]} icon={markIcon}>
              <Popup>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: '#000' }}>
                  <strong>Mark Panel {mark.id}</strong><br/>
                  Text: {mark.text}<br/>
                  Time: {Math.round(mark.time)}s
                </div>
              </Popup>
            </Marker>
          );
        })}

        {airbases.map((base, idx) => {
          if (!base.position || !base.position.lat || !base.position.lon) return null;

          let color = '#888'; // Neutral
          if (base.coalition === 'COALITION_RED') color = '#dc3545';
          else if (base.coalition === 'COALITION_BLUE') color = '#0d6efd';

          let symbol = `<svg width="18" height="18" viewBox="0 0 24 24" fill="${color}"><path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>`;
          if (base.category === 2) {
            // HELIPAD
            symbol = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="square"><path d="M7 4v16M17 4v16M7 12h10"/></svg>`;
          } else if (base.category === 3) {
            // SHIP
            symbol = `<svg width="16" height="16" viewBox="0 0 24 24" fill="${color}"><path d="M4 15V9h16v6l-2 3H6l-2-3zM8 9V5h8v4H8z"/></svg>`;
          }

          const baseIcon = new L.DivIcon({
            className: 'custom-airbase-icon',
            html: `<div style="background-color: rgba(10,10,10,0.9); border-radius: 50%; border: 2px solid ${color}; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 6px rgba(0,0,0,0.8);">
              ${symbol}
            </div>`,
            iconSize: [28, 28] as any,
            iconAnchor: [14, 14] as any
          });

          return (
            <Marker key={`airbase-${idx}`} position={[base.position.lat, base.position.lon]} icon={baseIcon}>
              <Popup>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: '#000' }}>
                  <strong>{base.display_name || base.name || base.callsign || 'Unknown Airbase'}</strong><br/>
                  Coalition: {base.coalition.replace('COALITION_', '')}<br/>
                  Type: {base.category === 2 ? 'FARP / Helipad' : base.category === 3 ? 'Carrier / Ship' : 'Airbase'}
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}
