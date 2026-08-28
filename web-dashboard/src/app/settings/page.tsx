'use client';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

type SettingValue = string | number | boolean;

interface ServerSettings {
  name?: string;
  password?: string;
  port?: number;
  maxPlayers?: number;
  description?: string;
  isPublic?: boolean;
  listShuffle?: boolean;
  listLoop?: boolean;
  advanced: Record<string, SettingValue>;
  [key: string]: unknown;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<ServerSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  useEffect(() => {
    apiFetch('/api/settings')
      .then(res => res.json())
      .then(setSettings)
      .catch(console.error);
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg('Saving...');
    try {
      const res = await apiFetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      if (!res.ok) throw new Error('Failed to save');
      setSaveMsg('Settings saved successfully!');
    } catch (e: unknown) {
      setSaveMsg(`Error: ${errorMessage(e)}`);
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(''), 3000);
    }
  };

  const updateSetting = (key: string, value: SettingValue) => {
    setSettings(current => current ? { ...current, [key]: value } : current);
  };

  const updateAdvanced = (key: string, value: SettingValue) => {
    setSettings(current => current ? {
      ...current,
      advanced: {
        ...current.advanced,
        [key]: value
      }
    } : current);
  };

  if (!settings) {
    return <div style={{ padding: '2rem', color: 'var(--text-secondary)' }}>Loading settings...</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '2rem', paddingBottom: '4rem' }}>
      <div>
        <h1>Server Settings</h1>
        <p style={{ color: 'var(--text-secondary)' }}>
          Manage your DCS Server configuration. Changes made here will be applied the next time the mission restarts.
        </p>
      </div>

      <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
        
        {/* Basic Settings */}
        <div style={{ flex: 1, minWidth: '300px', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          <div style={{ 
            backgroundColor: '#0b1118', 
            border: '1px solid var(--panel-border)', 
            borderRadius: '4px',
            padding: '2rem'
          }}>
            <h3 style={{ marginTop: 0, color: 'var(--primary)', borderBottom: '1px solid var(--panel-border)', paddingBottom: '0.5rem', marginBottom: '1.5rem' }}>Basic Settings</h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-secondary)', fontSize: '13px', textTransform: 'uppercase' }}>Server Name</label>
                <input 
                  type="text" 
                  value={settings.name || ''} 
                  onChange={(e) => updateSetting('name', e.target.value)}
                  style={{ width: '100%', padding: '0.75rem', backgroundColor: '#000', border: '1px solid var(--panel-border)', color: '#fff', borderRadius: '4px' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-secondary)', fontSize: '13px', textTransform: 'uppercase' }}>Password</label>
                <input 
                  type="text" 
                  value={settings.password || ''} 
                  onChange={(e) => updateSetting('password', e.target.value)}
                  placeholder="Leave empty for public server"
                  style={{ width: '100%', padding: '0.75rem', backgroundColor: '#000', border: '1px solid var(--panel-border)', color: '#fff', borderRadius: '4px' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '1rem' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-secondary)', fontSize: '13px', textTransform: 'uppercase' }}>Port</label>
                  <input 
                    type="number" 
                    value={settings.port || 10308} 
                    onChange={(e) => updateSetting('port', parseInt(e.target.value) || 10308)}
                    style={{ width: '100%', padding: '0.75rem', backgroundColor: '#000', border: '1px solid var(--panel-border)', color: '#fff', borderRadius: '4px' }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-secondary)', fontSize: '13px', textTransform: 'uppercase' }}>Max Players</label>
                  <input 
                    type="number" 
                    value={settings.maxPlayers || 16} 
                    onChange={(e) => updateSetting('maxPlayers', parseInt(e.target.value) || 16)}
                    style={{ width: '100%', padding: '0.75rem', backgroundColor: '#000', border: '1px solid var(--panel-border)', color: '#fff', borderRadius: '4px' }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-secondary)', fontSize: '13px', textTransform: 'uppercase' }}>Description</label>
                <textarea 
                  value={settings.description || ''} 
                  onChange={(e) => updateSetting('description', e.target.value)}
                  rows={8}
                  style={{ width: '100%', padding: '0.75rem', backgroundColor: '#000', border: '1px solid var(--panel-border)', color: '#fff', borderRadius: '4px', fontFamily: 'var(--font-mono)' }}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '1rem' }}>
                <input 
                  type="checkbox" 
                  checked={settings.isPublic || false} 
                  onChange={(e) => updateSetting('isPublic', e.target.checked)}
                  id="chk-public"
                  style={{ width: '20px', height: '20px' }}
                />
                <label htmlFor="chk-public" style={{ color: '#fff' }}>Public Server</label>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <input 
                  type="checkbox" 
                  checked={settings.listLoop || false} 
                  onChange={(e) => updateSetting('listLoop', e.target.checked)}
                  id="chk-loop"
                  style={{ width: '20px', height: '20px' }}
                />
                <label htmlFor="chk-loop" style={{ color: '#fff' }}>Loop Mission List</label>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <input 
                  type="checkbox" 
                  checked={settings.listShuffle || false} 
                  onChange={(e) => updateSetting('listShuffle', e.target.checked)}
                  id="chk-shuffle"
                  style={{ width: '20px', height: '20px' }}
                />
                <label htmlFor="chk-shuffle" style={{ color: '#fff' }}>Shuffle Mission List</label>
              </div>
            </div>
          </div>
        </div>

        {/* Advanced Settings */}
        <div style={{ flex: 2, minWidth: '300px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ 
            backgroundColor: '#0b1118', 
            border: '1px solid var(--panel-border)', 
            borderRadius: '4px',
            padding: '2rem'
          }}>
            <h3 style={{ marginTop: 0, color: 'var(--primary)', borderBottom: '1px solid var(--panel-border)', paddingBottom: '0.5rem', marginBottom: '1.5rem' }}>Advanced Rules</h3>
            
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', 
              gap: '1rem',
              maxHeight: '600px',
              overflowY: 'auto',
              paddingRight: '1rem'
            }}>
              {Object.keys(settings.advanced || {}).sort().map((key) => {
                const val = settings.advanced[key];
                
                if (typeof val === 'boolean') {
                  return (
                    <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem', backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: '4px' }}>
                      <input 
                        type="checkbox" 
                        checked={val} 
                        onChange={(e) => updateAdvanced(key, e.target.checked)}
                        id={`adv-${key}`}
                        style={{ width: '16px', height: '16px' }}
                      />
                      <label htmlFor={`adv-${key}`} style={{ color: '#fff', fontSize: '13px', cursor: 'pointer' }}>{key}</label>
                    </div>
                  );
                }
                
                if (typeof val === 'number') {
                  return (
                    <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', padding: '0.5rem', backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: '4px' }}>
                      <label style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>{key}</label>
                      <input 
                        type="number" 
                        value={val} 
                        onChange={(e) => updateAdvanced(key, parseInt(e.target.value) || 0)}
                        style={{ width: '100%', padding: '0.25rem 0.5rem', backgroundColor: '#000', border: '1px solid var(--panel-border)', color: '#fff', borderRadius: '4px' }}
                      />
                    </div>
                  );
                }

                return null;
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Floating Action Bar */}
      <div className="settings-floating-bar">
        <div style={{ color: saveMsg.startsWith('Error') ? '#ff4444' : 'var(--success)' }}>
          {saveMsg}
        </div>
        <button 
          onClick={handleSave}
          disabled={saving}
          style={{
            padding: '0.75rem 2rem',
            backgroundColor: 'var(--primary)',
            color: '#000',
            border: 'none',
            borderRadius: '4px',
            fontWeight: 'bold',
            textTransform: 'uppercase',
            cursor: saving ? 'not-allowed' : 'pointer',
            opacity: saving ? 0.7 : 1
          }}
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>

    </div>
  );
}
