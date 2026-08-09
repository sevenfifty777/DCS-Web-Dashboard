"use client";
import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, CircleMarker } from 'react-leaflet';
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
    lat: number;
    lon: number;
}

interface FootholdAttack {
    group_name: string;
    origin_zone: string;
    target_zone: string;
    side: number;
    mission_type: string;
    alive_count: number;
    unit_types: string[];
}

export default function RedAttacksMap({ attacks, zones }: { attacks: FootholdAttack[], zones: FootholdZone[] }) {
    const [units, setUnits] = useState<Record<string, any>>({});

    useEffect(() => {
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

    const center = zones.length > 0 ? [zones[0].lat, zones[0].lon] : [42.0, 42.0];
    
    // Create lookup map
    const zoneMap: Record<string, FootholdZone> = {};
    zones.forEach(z => {
        zoneMap[z.name] = z;
    });

    return (
        <div style={{ position: 'relative', height: '500px', width: '100%', borderRadius: '1rem', overflow: 'hidden', border: '1px solid #374151' }}>
            <MapContainer center={center as [number, number]} zoom={7} style={{ height: '100%', width: '100%', backgroundColor: '#0b1118', zIndex: 0 }}>
                <TileLayer
                    url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                    attribution='&copy; OpenStreetMap contributors &copy; CARTO'
                />
                
                {attacks.map((attack, idx) => {
                    const origin = zoneMap[attack.origin_zone];
                    const target = zoneMap[attack.target_zone];
                    
                    if (!origin || !target || (origin.lat === 0 && origin.lon === 0)) return null;
                    
                    const color = attack.side === 1 ? '#dc3545' : attack.side === 2 ? '#0d6efd' : '#ffc107';

                    const unitCounts = attack.unit_types.reduce((acc, curr) => {
                        acc[curr] = (acc[curr] || 0) + 1;
                        return acc;
                    }, {} as Record<string, number>);

                    // Calculate midpoint to place the marker
                    const midLat = (origin.lat + target.lat) / 2;
                    const midLon = (origin.lon + target.lon) / 2;

                    const attackIcon = new L.DivIcon({
                        className: 'custom-attack-icon',
                        html: `<div style="background-color: ${color}; width: 14px; height: 14px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 10px ${color};"></div>`,
                        iconSize: [14, 14],
                        iconAnchor: [7, 7]
                    });

                    return (
                        <div key={`attack-${idx}`}>
                            <Polyline 
                                positions={[[origin.lat, origin.lon], [target.lat, target.lon]]}
                                pathOptions={{ color, weight: 3, dashArray: '10, 10' }}
                            />
                            <Marker position={[midLat, midLon]} icon={attackIcon}>
                                <Popup>
                                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: '#000', minWidth: '150px' }}>
                                        <strong style={{ fontSize: '14px', borderBottom: '1px solid #ccc', paddingBottom: '4px', marginBottom: '4px', display: 'block', color }}>{attack.group_name}</strong>
                                        Mission: {attack.mission_type}<br/>
                                        Route: {attack.origin_zone} ➡️ {attack.target_zone}<br/>
                                        Alive Count: {attack.alive_count}<br/><br/>
                                        <strong>Composition:</strong>
                                        <ul style={{ paddingLeft: '20px', margin: '4px 0 0 0', maxHeight: '150px', overflowY: 'auto' }}>
                                            {Object.entries(unitCounts).map(([name, count]) => (
                                                <li key={name}>{count}x {name}</li>
                                            ))}
                                        </ul>
                                    </div>
                                </Popup>
                            </Marker>
                        </div>
                    );
                })}

                {/* Plot Live Units */}
                {Object.values(units).map((unit) => {
                    if (!unit.position || !unit.position.lat || !unit.position.lon) return null;
                    
                    const unitName = unit.name || "";
                    const groupName = unit.group?.name || "";
                    
                    // Match this unit to an attack by group name or prefix
                    const attack = attacks.find(a => 
                        a.group_name === groupName || 
                        unitName.startsWith(a.group_name)
                    );

                    if (!attack) return null; // Not part of a tracked AI activity

                    const color = attack.side === 1 ? '#dc3545' : attack.side === 2 ? '#0d6efd' : '#ffc107';

                    return (
                        <CircleMarker 
                            key={`unit-${unit.id}`} 
                            center={[unit.position.lat, unit.position.lon]}
                            radius={5}
                            pathOptions={{ color, fillColor: color, fillOpacity: 0.8, weight: 1 }}
                        >
                            <Popup>
                                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: '#000' }}>
                                    <strong style={{ color }}>{unitName}</strong><br/>
                                    Type: {unit.type}<br/>
                                    Alt: {Math.round(unit.position.alt)}m<br/>
                                    Speed: {Math.round((unit.velocity?.speed || 0) * 1.94384)} kts<br/>
                                    Activity: {attack.mission_type}
                                </div>
                            </Popup>
                        </CircleMarker>
                    );
                })}
            </MapContainer>
        </div>
    );
}
