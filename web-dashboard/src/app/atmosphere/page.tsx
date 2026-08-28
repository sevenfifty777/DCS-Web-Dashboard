"use client";
import { useState } from 'react';
import * as mgrs from 'mgrs';
import { apiFetch } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

interface AtmosphereData {
  coords: { lat: number; lon: number; alt: number };
  wind: { heading: number; strength: number };
  atmosphere: { temperature: number; pressure: number };
}

export default function AtmospherePage() {
  const [inputStr, setInputStr] = useState("Lat Long Precise: N 41°36'56.36\"   E 40°38'05.65\"\nAltitude: 0 m / 0 feet");
  const [data, setData] = useState<AtmosphereData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parseCoordinates = (input: string): { lat: number, lon: number, alt?: number } | null => {
    const text = input.trim().toUpperCase();
    
    let alt: number = 0;

    // Try to parse altitude anywhere in the string (e.g. "Altitude: 123 m" or "123m")
    const altRegex = /ALTITUDE:\s*([\d.]+)\s*M/i;
    const altMatch = text.match(altRegex);
    if (altMatch) {
      alt = parseFloat(altMatch[1]);
    }

    // Try Precise/Standard DMS (e.g. N 41°36'56.36" E 40°38'05.65")
    const dmsRegex = /([NS])\s*(\d+)°\s*(\d+)'\s*([\d.]+)"\s*([EW])\s*(\d+)°\s*(\d+)'\s*([\d.]+)"/i;
    const dmsMatch = text.match(dmsRegex);
    if (dmsMatch) {
      let lat = parseInt(dmsMatch[2]) + parseInt(dmsMatch[3])/60 + parseFloat(dmsMatch[4])/3600;
      if (dmsMatch[1] === 'S') lat = -lat;

      let lon = parseInt(dmsMatch[6]) + parseInt(dmsMatch[7])/60 + parseFloat(dmsMatch[8])/3600;
      if (dmsMatch[5] === 'W') lon = -lon;
      
      return { lat, lon, alt };
    }

    // Try Decimal Minutes (DMM) (e.g. N 41°36.939' E 40°38.094')
    const dmmRegex = /([NS])\s*(\d+)°\s*([\d.]+)'\s*([EW])\s*(\d+)°\s*([\d.]+)'/i;
    const dmmMatch = text.match(dmmRegex);
    if (dmmMatch) {
      let lat = parseInt(dmmMatch[2]) + parseFloat(dmmMatch[3])/60;
      if (dmmMatch[1] === 'S') lat = -lat;

      let lon = parseInt(dmmMatch[5]) + parseFloat(dmmMatch[6])/60;
      if (dmmMatch[4] === 'W') lon = -lon;
      
      return { lat, lon, alt };
    }

    // Try MGRS (e.g. MGRS GRID: 37 T FG 36212 08395)
    const mgrsBlockRegex = /MGRS GRID:\s*(\d{1,2})\s*([C-X])\s*([A-Z]{2})\s*(\d{5})\s*(\d{5})/i;
    const mgrsBlockMatch = text.match(mgrsBlockRegex);
    if (mgrsBlockMatch) {
      try {
        const mgrsStr = `${mgrsBlockMatch[1]}${mgrsBlockMatch[2]}${mgrsBlockMatch[3]}${mgrsBlockMatch[4]}${mgrsBlockMatch[5]}`;
        const pt = mgrs.toPoint(mgrsStr);
        return { lat: pt[1], lon: pt[0], alt };
      } catch { /* try the next supported coordinate format */ }
    }

    // Try exact MGRS without prefix (e.g. 37 T FG 36212 08395)
    const mgrsExact = /^(\d{1,2})\s*([C-X])\s*([A-Z]{2})\s*(\d{5})\s*(\d{5})$/i;
    const mgrsExactMatch = text.match(mgrsExact);
    if (mgrsExactMatch) {
      try {
        const mgrsStr = `${mgrsExactMatch[1]}${mgrsExactMatch[2]}${mgrsExactMatch[3]}${mgrsExactMatch[4]}${mgrsExactMatch[5]}`;
        const pt = mgrs.toPoint(mgrsStr);
        return { lat: pt[1], lon: pt[0], alt };
      } catch { /* try the next supported coordinate format */ }
    }

    // Try Decimal Degrees (e.g. 41.615555, 40.634722)
    const ddRegex = /^(-?\d+\.\d+)[,\s]+(-?\d+\.\d+)$/;
    const ddMatch = text.match(ddRegex);
    if (ddMatch) {
      return { lat: parseFloat(ddMatch[1]), lon: parseFloat(ddMatch[2]), alt };
    }

    return null;
  };

  const fetchWeather = async () => {
    setLoading(true);
    setError(null);
    setData(null);

    const coords = parseCoordinates(inputStr);
    if (!coords) {
      setError('Could not parse valid coordinates. Try pasting DCS F10 map coordinates.');
      setLoading(false);
      return;
    }

    try {
      const res = await apiFetch(`/api/atmosphere?lat=${coords.lat}&lon=${coords.lon}&alt=${coords.alt}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setData({ ...json, coords });
    } catch (err: unknown) {
      setError(errorMessage(err));
    }
    setLoading(false);
  };

  // Conversions
  const kToC = (k: number) => (k - 273.15).toFixed(1);
  const paToInHg = (pa: number) => (pa * 0.0002953).toFixed(2);
  const paToHpa = (pa: number) => (pa / 100).toFixed(1);
  const mpsToKts = (mps: number) => (mps * 1.94384).toFixed(1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <h1>Weather & Atmosphere</h1>
      <p style={{ color: 'var(--text-secondary)' }}>
        Query live atmospheric conditions (wind, temperature, pressure). You can paste coordinates directly from the DCS F10 map (LAlt + Left Click).
      </p>

      <div style={{ display: 'flex', gap: '2rem', marginTop: '1rem', flexWrap: 'wrap' }}>
        <div style={{ 
          flex: 1,
          backgroundColor: '#0b1118', 
          border: '1px solid var(--panel-border)', 
          borderRadius: '4px',
          padding: '2rem',
          minWidth: '300px',
          display: 'flex',
          flexDirection: 'column'
        }}>
          <h3 style={{ marginTop: 0, color: 'var(--primary)', borderBottom: '1px solid var(--panel-border)', paddingBottom: '0.5rem' }}>Location Parameters</h3>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1.5rem', flex: 1 }}>
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>DCS Coordinates (Paste block here)</label>
              <textarea 
                value={inputStr} 
                onChange={e => setInputStr(e.target.value)} 
                placeholder="Paste Lat/Lon, MGRS, or the entire block from DCS here..."
                style={{
                  width: '100%',
                  flex: 1,
                  minHeight: '150px',
                  padding: '1rem',
                  backgroundColor: 'rgba(0, 0, 0, 0.5)',
                  border: '1px solid var(--panel-border)',
                  borderRadius: '4px',
                  color: '#fff',
                  fontFamily: 'var(--font-mono)',
                  resize: 'vertical',
                  outline: 'none'
                }}
              />
            </div>

            <button 
              onClick={fetchWeather}
              disabled={loading || !inputStr.trim()}
              style={{
                padding: '1rem',
                backgroundColor: 'var(--primary)',
                border: 'none',
                color: '#000',
                borderRadius: '4px',
                cursor: (loading || !inputStr.trim()) ? 'not-allowed' : 'pointer',
                fontWeight: 'bold',
                textTransform: 'uppercase',
                letterSpacing: '1px',
                opacity: (loading || !inputStr.trim()) ? 0.7 : 1
              }}
            >
              {loading ? 'Querying Sensor...' : 'Fetch Weather Data'}
            </button>
            
            {error && (
              <div style={{ marginTop: '0.5rem', padding: '1rem', backgroundColor: 'rgba(255, 68, 68, 0.1)', border: '1px solid #ff4444', borderRadius: '4px', color: '#ff4444', fontFamily: 'var(--font-mono)' }}>
                ✗ {error}
              </div>
            )}
          </div>
        </div>

        <div style={{ flex: 1, minWidth: '300px' }}>
          {data ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ padding: '1rem', backgroundColor: 'rgba(0, 212, 255, 0.05)', border: '1px solid var(--primary)', borderRadius: '4px', color: 'var(--primary)', fontFamily: 'var(--font-mono)' }}>
                <strong>Parsed Coordinates:</strong> Lat {data.coords.lat.toFixed(6)}, Lon {data.coords.lon.toFixed(6)}, Alt {data.coords.alt}m
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '1rem' }}>
                <div style={{ backgroundColor: '#0b1118', border: '1px solid var(--panel-border)', borderRadius: '4px', padding: '1.5rem', textAlign: 'center' }}>
                  <div style={{ color: 'var(--text-secondary)', textTransform: 'uppercase', fontSize: '12px', letterSpacing: '1px', marginBottom: '1rem' }}>Wind Heading</div>
                  <div style={{ fontSize: '3rem', fontWeight: 'bold', color: 'var(--primary)', fontFamily: 'var(--font-mono)' }}>{Math.round(data.wind.heading)}°</div>
                </div>
                
                <div style={{ backgroundColor: '#0b1118', border: '1px solid var(--panel-border)', borderRadius: '4px', padding: '1.5rem', textAlign: 'center' }}>
                  <div style={{ color: 'var(--text-secondary)', textTransform: 'uppercase', fontSize: '12px', letterSpacing: '1px', marginBottom: '1rem' }}>Wind Speed</div>
                  <div style={{ fontSize: '3rem', fontWeight: 'bold', color: '#fff', fontFamily: 'var(--font-mono)' }}>{mpsToKts(data.wind.strength)}<span style={{ fontSize: '1rem', color: 'var(--text-secondary)'}}> kts</span></div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>{data.wind.strength.toFixed(1)} m/s</div>
                </div>

                <div style={{ backgroundColor: '#0b1118', border: '1px solid var(--panel-border)', borderRadius: '4px', padding: '1.5rem', textAlign: 'center' }}>
                  <div style={{ color: 'var(--text-secondary)', textTransform: 'uppercase', fontSize: '12px', letterSpacing: '1px', marginBottom: '1rem' }}>Temperature</div>
                  <div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: '#ffaa00', fontFamily: 'var(--font-mono)' }}>{kToC(data.atmosphere.temperature)}°C</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>{data.atmosphere.temperature.toFixed(2)} K</div>
                </div>

                <div style={{ backgroundColor: '#0b1118', border: '1px solid var(--panel-border)', borderRadius: '4px', padding: '1.5rem', textAlign: 'center' }}>
                  <div style={{ color: 'var(--text-secondary)', textTransform: 'uppercase', fontSize: '12px', letterSpacing: '1px', marginBottom: '1rem' }}>Pressure</div>
                  <div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: '#fff', fontFamily: 'var(--font-mono)' }}>{paToInHg(data.atmosphere.pressure)}<span style={{ fontSize: '1rem', color: 'var(--text-secondary)'}}> inHg</span></div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>{paToHpa(data.atmosphere.pressure)} hPa (QFE)</div>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', backgroundColor: 'rgba(0,0,0,0.2)', border: '1px dashed var(--panel-border)', borderRadius: '4px', color: 'var(--text-secondary)' }}>
              No data fetched yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
