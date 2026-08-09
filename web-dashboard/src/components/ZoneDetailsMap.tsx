"use client";
import { MapContainer, TileLayer, Marker, Popup, Circle } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix for default Leaflet icons in Next.js
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

interface FootholdZone {
    name: string;
    side: number;
    level: number;
    lat: number;
    lon: number;
    units: string[];
}

export default function ZoneDetailsMap({ zones }: { zones: FootholdZone[] }) {
    const center = zones.length > 0 ? [zones[0].lat, zones[0].lon] : [42.0, 42.0];

    return (
        <div style={{ position: 'relative', height: '500px', width: '100%', borderRadius: '1rem', overflow: 'hidden', border: '1px solid #374151' }}>
            <MapContainer center={center as [number, number]} zoom={7} style={{ height: '100%', width: '100%', backgroundColor: '#0b1118', zIndex: 0 }}>
                <TileLayer
                    url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                    attribution='&copy; OpenStreetMap contributors &copy; CARTO'
                />
                
                {zones.map((zone, idx) => {
                    if (zone.lat === 0 && zone.lon === 0) return null;
                    
                    let color = '#6c757d';
                    let fillColor = '#6c757d';
                    if (zone.side === 1) { color = '#dc3545'; fillColor = '#dc3545'; }
                    if (zone.side === 2) { color = '#0d6efd'; fillColor = '#0d6efd'; }

                    const pathOptions = {
                        color,
                        fillColor,
                        fillOpacity: 0.3,
                        weight: 2
                    };

                    // Count units
                    const unitCounts = (zone.units || []).reduce((acc, curr) => {
                        acc[curr] = (acc[curr] || 0) + 1;
                        return acc;
                    }, {} as Record<string, number>);

                    return (
                        <Circle key={`zone-${idx}`} center={[zone.lat, zone.lon]} radius={3000} pathOptions={pathOptions}>
                            <Popup>
                                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: '#000', minWidth: '150px' }}>
                                    <strong style={{ fontSize: '14px', borderBottom: '1px solid #ccc', paddingBottom: '4px', marginBottom: '4px', display: 'block' }}>{zone.name}</strong>
                                    Side: <span style={{ color, fontWeight: 'bold' }}>{zone.side === 1 ? 'Red' : zone.side === 2 ? 'Blue' : 'Neutral'}</span><br/>
                                    Level: {zone.level}<br/><br/>
                                    <strong>Alive Units: {(zone.units || []).length}</strong>
                                    <ul style={{ paddingLeft: '20px', margin: '4px 0 0 0', maxHeight: '150px', overflowY: 'auto' }}>
                                        {Object.entries(unitCounts).map(([name, count]) => (
                                            <li key={name}>{count}x {name}</li>
                                        ))}
                                    </ul>
                                </div>
                            </Popup>
                        </Circle>
                    );
                })}
            </MapContainer>
        </div>
    );
}
