'use client';

import { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api';
import styles from './page.module.css';

export default function WeatherPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [applying, setApplying] = useState<string | null>(null);

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
        body: JSON.stringify({ preset_id: presetId })
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
        <h3 className={styles.sectionTitle}>Presets Disponibles</h3>
        <div className={styles.grid}>
          {Object.entries(presets).map(([id, preset]: [string, any]) => (
            <div key={id} className={styles.card}>
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
