'use client';

import { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api';
import styles from './page.module.css';

function getPresetThumbnail(presetName: string, cloudsPreset: string): string {
  const n = (presetName || '').toLowerCase();
  const c = (cloudsPreset || '').toLowerCase();

  if (c.match(/preset8[1-8]/)) return `/weather-thumbnails/${cloudsPreset}.png`;

  if (n.includes('altocumulus 1')) return '/weather-thumbnails/altocumulus1.png';
  if (n.includes('altocumulus 2')) return '/weather-thumbnails/altocumulus2.png';
  if (n.includes('altocumulus 3')) return '/weather-thumbnails/altocumulus3.png';
  if (n.includes('altocumulus 4')) return '/weather-thumbnails/altocumulus4.png';
  
  if (n.includes('altostratus 1')) return '/weather-thumbnails/altostratus1.png';
  if (n.includes('altostratus 2')) return '/weather-thumbnails/altostratus2.png';
  if (n.includes('altostratus 3')) return '/weather-thumbnails/altostratus3.png';
  if (n.includes('altostratus 4')) return '/weather-thumbnails/altostratus4.png';
  
  if (n.includes('cirrocumulus 1')) return '/weather-thumbnails/cirrocumulus1.png';
  if (n.includes('cirrocumulus 2')) return '/weather-thumbnails/cirrocumulus2.png';
  if (n.includes('cirrocumulus 3')) return '/weather-thumbnails/cirrocumulus3.png';
  
  if (n.includes('cirrostratus 1')) return '/weather-thumbnails/cirrostratus1.png';
  if (n.includes('cirrostratus 2')) return '/weather-thumbnails/cirrostratus2.png';
  if (n.includes('cirrostratus 3')) return '/weather-thumbnails/cirrostratus3.png';
  if (n.includes('cirrostratus 4')) return '/weather-thumbnails/cirrostratus4.png';

  if (n.includes('broken cumulus')) return '/weather-thumbnails/cumulus3.png';
  if (n.includes('cumulus 1') || n.includes('scattered cumulus')) return '/weather-thumbnails/cumulus1.png';
  
  if (n.includes('rain') || n.includes('shower')) return '/weather-thumbnails/OvercastRain1.png';
  if (n.includes('tstorm') || n.includes('thunder')) return '/weather-thumbnails/tstorm1.png';
  
  if (n.includes('atx') || n.includes('atmosx')) return '/weather-thumbnails/atmosx_default_thumb.png';

  if (c.startsWith('preset')) {
    const num = c.replace('preset', '');
    return `/weather-thumbnails/cloud_${num}.png`;
  }
  
  return '/weather-thumbnails/cloudsMap01.png';
}

function getTimeOfDayIndicator(timeStr: string) {
  if (!timeStr) return null;
  const [hoursStr] = timeStr.split(':');
  const h = parseInt(hoursStr, 10);
  
  if (h >= 4 && h < 8) return { label: 'Aube', icon: '🌅' };
  if (h >= 8 && h < 18) return { label: 'Jour', icon: '☀️' };
  if (h >= 18 && h < 21) return { label: 'Crépuscule', icon: '🌇' };
  return { label: 'Nuit', icon: '🌙' };
}

export default function WeatherPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [applying, setApplying] = useState<string | null>(null);
  const [timeOfDay, setTimeOfDay] = useState('keep');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const res = await apiFetch('/api/weather');
      const json = await res.json();
      if (res.ok) {
        setData(json);
      } else {
        setError(json.error || 'Failed to fetch weather data');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const applyPreset = async (presetId: string) => {
    if (!confirm(`Voulez-vous vraiment appliquer le preset ${presetId} ?\n\nCela va redémarrer la mission en cours immédiatement !`)) {
      return;
    }
    setApplying(presetId);
    try {
      const res = await apiFetch('/api/weather/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          preset_id: presetId,
          time_of_day: timeOfDay === 'keep' ? undefined : timeOfDay
        })
      });
      const json = await res.json();
      if (res.ok) {
        alert('Le preset météo a été appliqué et la mission a redémarré !');
        fetchData(); // refresh current state
      } else {
        alert('Erreur : ' + (json.error || 'Erreur inconnue'));
      }
    } catch (err: any) {
      alert('Erreur : ' + err.message);
    } finally {
      setApplying(null);
    }
  };

  if (loading) return <div className={styles.container}>Chargement des données météo...</div>;
  if (error) return <div className={styles.container}>Erreur: {error}</div>;

  if (data?.not_configured) {
    return (
      <div className={styles.container}>
        <div style={{ padding: '50px 20px', textAlign: 'center', backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: 12, marginTop: 40 }}>
          <h2 style={{ color: '#888', marginBottom: 15 }}>☁️ Météo Dynamique Désactivée</h2>
          <p style={{ color: '#666', fontSize: '1.1rem' }}>
            Le module de météo dynamique n'est pas configuré pour ce serveur.
          </p>
        </div>
      </div>
    );
  }

  const presets = data?.presets || {};
  const currentState = data?.current_state || {};
  
  // Find current preset details
  const appliedPresetId = currentState?.applied_preset;
  const currentPresetInfo = appliedPresetId ? presets[appliedPresetId] : null;

  return (
    <div className={styles.container}>
      <h2>Dynamic Weather Management</h2>
      
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Météo actuellement appliquée</h3>
        {currentState.mission ? (
          <div>
            <p><strong>Mission :</strong> {currentState.mission}</p>
            {currentState.mission_time && (
              <p>
                <strong>Heure de la mission :</strong> {currentState.mission_time} 
                <span style={{ marginLeft: 10, color: '#00bfff' }}>
                  {getTimeOfDayIndicator(currentState.mission_time)?.icon} {getTimeOfDayIndicator(currentState.mission_time)?.label}
                </span>
              </p>
            )}
            {currentPresetInfo ? (
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 5 }}>
                <p><strong>Preset :</strong> <span style={{color: '#00bfff'}}>{currentPresetInfo.name}</span></p>
                <p><strong>Description :</strong> {currentPresetInfo.description}</p>
                <div style={{display: 'flex', gap: 20, marginTop: 10}}>
                  <div>
                    <p><strong>Température :</strong> {currentPresetInfo.temperature}°C</p>
                    <p><strong>QNH :</strong> {currentPresetInfo.qnh}</p>
                  </div>
                  <div>
                    <p><strong>Visibilité :</strong> {currentPresetInfo.visibility}m</p>
                    <p><strong>Nuages :</strong> {currentPresetInfo.clouds?.preset}</p>
                  </div>
                </div>
              </div>
            ) : (
              <p>ID du preset appliqué : {appliedPresetId || 'Inconnu'}</p>
            )}
          </div>
        ) : (
          <p>Aucune donnée météo trouvée pour la mission en cours. Générez un preset pour initialiser.</p>
        )}
      </div>

      <div className={styles.section}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', borderBottom: '1px solid var(--panel-border)', paddingBottom: '10px' }}>
          <h3 className={styles.sectionTitle} style={{ borderBottom: 'none', marginBottom: 0, paddingBottom: 0 }}>Presets Disponibles</h3>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <label htmlFor="timeOfDay" style={{ color: '#ccc', fontSize: '0.9rem' }}>Heure du jour :</label>
            <select 
              id="timeOfDay"
              value={timeOfDay} 
              onChange={(e) => setTimeOfDay(e.target.value)}
              style={{
                background: 'rgba(0,0,0,0.2)',
                color: 'white',
                border: '1px solid var(--panel-border)',
                padding: '6px 10px',
                borderRadius: '4px',
                outline: 'none',
                cursor: 'pointer'
              }}
            >
              <option value="keep">Conserver (Défaut)</option>
              <option value="random">Aléatoire</option>
              <option value="dawn">Aube (04h-07h)</option>
              <option value="day">Jour (08h-17h)</option>
              <option value="dusk">Crépuscule (18h-20h)</option>
              <option value="night">Nuit (21h-03h)</option>
            </select>
          </div>
        </div>

        <div className={styles.grid}>
          {Object.entries(presets).map(([id, preset]: [string, any]) => (
            <div key={id} className={styles.card}>
              <div className={styles.cardImageWrapper}>
                <img src={getPresetThumbnail(preset.name, preset.clouds?.preset)} alt={preset.name} className={styles.cardImage} />
              </div>
              <div className={styles.cardCategory}>{preset.category}</div>
              <h4 className={styles.cardTitle}>{preset.name}</h4>
              <div className={styles.cardDesc}>{preset.description}</div>
              
              <div className={styles.cardDetails}>
                <span>🌡️ Temp: {preset.temperature}°C | 🔽 QNH: {preset.qnh}</span>
                <span>☁️ Nuages: {preset.clouds?.preset} (Base: {preset.clouds?.base}m)</span>
                <span>💨 Vent: {preset.wind?.ground?.speed} m/s @ {preset.wind?.ground?.direction}°</span>
              </div>
              
              <button 
                className={styles.btn}
                onClick={() => applyPreset(id)}
                disabled={applying !== null}
              >
                {applying === id ? 'Application...' : 'Appliquer & Redémarrer'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
