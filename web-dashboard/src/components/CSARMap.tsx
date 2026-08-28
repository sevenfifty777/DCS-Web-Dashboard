"use client";
import { MapContainer, TileLayer, Marker, Popup, LayersControl } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix for default Leaflet icons in Next.js
delete (L.Icon.Default.prototype as L.Icon.Default & { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

interface Pilot {
    id: number;
    coalition: number;
    player_name: string;
    lat: number;
    lon: number;
    alt: number;
    timestamp: number;
}

export default function CSARMap({ pilots }: { pilots: Pilot[] }) {
    // Start center around Caucasus by default, or center on the first pilot if available.
    const center: [number, number] = pilots.length > 0 ? [pilots[0].lat, pilots[0].lon] : [42.0, 42.0];

    return (
        <div style={{ position: 'relative', height: '400px', width: '100%', borderRadius: '1rem', overflow: 'hidden', border: '1px solid #374151' }}>
            <MapContainer center={center} zoom={8} style={{ height: '100%', width: '100%', backgroundColor: '#0b1118' }}>
                <LayersControl position="bottomleft">
                  <LayersControl.BaseLayer checked name="CARTO Dark">
                    <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" attribution='&copy; OpenStreetMap contributors &copy; CARTO' />
                  </LayersControl.BaseLayer>
                  <LayersControl.BaseLayer name="ArcGIS Satellite">
                    <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" attribution="Tiles &copy; Esri" />
                  </LayersControl.BaseLayer>
                </LayersControl>

                {pilots.map((p, idx) => {
                    const color = p.coalition === 2 ? '#3b82f6' : '#ef4444'; // blue or red
                    const pilotIcon = new L.DivIcon({
                        className: 'custom-pilot-icon',
                        html: `<div style="background-color: ${color}22; border: 2px solid ${color}; border-radius: 50%; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 12px ${color};">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                               </div>`,
                        iconSize: [28, 28],
                        iconAnchor: [14, 14]
                    });

                    return (
                        <Marker key={p.id || idx} position={[p.lat, p.lon]} icon={pilotIcon}>
                            <Popup>
                                <div style={{ fontFamily: 'monospace', fontSize: '12px', color: '#000' }}>
                                    <strong style={{fontSize: '14px', color: color}}>DOWNED PILOT</strong><br/>
                                    Name: {p.player_name || 'Unknown'}<br/>
                                    Coalition: {p.coalition === 2 ? 'BLUE' : 'RED'}<br/>
                                    Alt: {Math.round(p.alt)}m<br/>
                                    Coords: {p.lat.toFixed(4)}, {p.lon.toFixed(4)}
                                </div>
                            </Popup>
                        </Marker>
                    );
                })}
            </MapContainer>
        </div>
    );
}
