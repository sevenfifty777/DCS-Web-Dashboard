"use client";
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

export default function SrsPage() {
  const [settings, setSettings] = useState<any>(null);
  const [clients, setClients] = useState<any[]>([]);
  const [serverVersion, setServerVersion] = useState<string>('');
  const [srsProcess, setSrsProcess] = useState({ running: false, checking: true });
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const fetchSrsData = () => {
    apiFetch('/api/srs/clients')
      .then(res => res.json())
      .then(data => {
        if (data.Clients) setClients(data.Clients);
        if (data.ServerVersion) setServerVersion(data.ServerVersion);
        if (data.error) setErrorMsg(data.error);
      })
      .catch(console.error);

    apiFetch('/api/server/srs-process')
      .then(r => r.json())
      .then(d => setSrsProcess({ running: d.running, checking: false }))
      .catch(() => setSrsProcess({ running: false, checking: false }));
  };

  useEffect(() => {
    apiFetch('/api/srs/settings')
      .then(res => res.json())
      .then(data => {
        if (data.error) {
            setErrorMsg(data.error);
        } else {
            setSettings(data);
        }
      })
      .catch(console.error);

    fetchSrsData();
    const interval = setInterval(fetchSrsData, 5000);
    return () => clearInterval(interval);
  }, []);

  const manageSrsProcess = (action: 'start' | 'stop' | 'restart') => {
    setSrsProcess(p => ({ ...p, checking: true }));
    apiFetch('/api/server/srs-process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action })
    })
      .then(r => r.json())
      .then(() => {
        setTimeout(fetchSrsData, 2000);
      })
      .catch(console.error);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg('Saving...');
    try {
      const res = await apiFetch('/api/srs/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      if (!res.ok) {
          const e = await res.json();
          throw new Error(e.error || 'Failed to save');
      }
      setSaveMsg('Settings saved successfully!');
    } catch (e: any) {
      setSaveMsg(`Error: ${e.message}`);
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(''), 3000);
    }
  };

  const updateSetting = (section: string, key: string, value: any) => {
    setSettings((prev: any) => ({
      ...prev,
      [section]: {
        ...prev[section],
        [key]: value
      }
    }));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <h1>SRS Management</h1>
      <p style={{ color: 'var(--text-secondary)' }}>
        Manage SimpleRadio Standalone server process, settings, and view connected players.
      </p>

      {errorMsg && (
        <div style={{ backgroundColor: 'rgba(255,68,68,0.1)', border: '1px solid #ff4444', color: '#ff4444', padding: '1rem', borderRadius: '4px', marginBottom: '1rem' }}>
          {errorMsg}
        </div>
      )}

      <div style={{ display: 'flex', gap: '2rem', marginTop: '1.5rem', flexWrap: 'wrap' }}>
        
        {/* Left Column: Controls & Clients */}
        <div style={{ flex: 1, minWidth: '350px', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          
          {/* SRS Process Box */}
          <div style={{ 
            backgroundColor: '#0b1118', 
            border: '1px solid var(--panel-border)', 
            borderRadius: '4px',
            padding: '2rem'
          }}>
            <h3 style={{ marginTop: 0, color: '#f78c2e', borderBottom: '1px solid var(--panel-border)', paddingBottom: '0.5rem', marginBottom: '1.5rem' }}>
              SRS Server Process
              {serverVersion && <span style={{ float: 'right', fontSize: '12px', color: 'var(--text-secondary)' }}>v{serverVersion}</span>}
            </h3>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2rem' }}>
              <span style={{ color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '1px', fontSize: '12px' }}>Process State</span>
              <strong style={{ 
                color: srsProcess.checking ? 'var(--text-secondary)' : (srsProcess.running ? '#00ff88' : '#ff4444'), 
                fontFamily: 'var(--font-mono)' 
              }}>
                {srsProcess.checking ? 'CHECKING...' : (srsProcess.running ? 'RUNNING' : 'STOPPED')}
              </strong>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
              <button 
                onClick={() => manageSrsProcess('start')}
                disabled={srsProcess.running || srsProcess.checking}
                style={{
                  padding: '0.75rem',
                  backgroundColor: 'rgba(0, 255, 136, 0.1)',
                  border: '1px solid #00ff88',
                  color: '#00ff88',
                  borderRadius: '4px',
                  cursor: (srsProcess.running || srsProcess.checking) ? 'not-allowed' : 'pointer',
                  fontWeight: 'bold',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                  opacity: (srsProcess.running || srsProcess.checking) ? 0.3 : 1
                }}
              >
                Start
              </button>
              <button 
                onClick={() => manageSrsProcess('stop')}
                disabled={!srsProcess.running || srsProcess.checking}
                style={{
                  padding: '0.75rem',
                  backgroundColor: 'rgba(255, 68, 68, 0.1)',
                  border: '1px solid #ff4444',
                  color: '#ff4444',
                  borderRadius: '4px',
                  cursor: (!srsProcess.running || srsProcess.checking) ? 'not-allowed' : 'pointer',
                  fontWeight: 'bold',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                  opacity: (!srsProcess.running || srsProcess.checking) ? 0.3 : 1
                }}
              >
                Stop
              </button>
              <button 
                onClick={() => manageSrsProcess('restart')}
                disabled={srsProcess.checking}
                style={{
                  padding: '0.75rem',
                  backgroundColor: 'rgba(255, 170, 0, 0.1)',
                  border: '1px solid #ffaa00',
                  color: '#ffaa00',
                  borderRadius: '4px',
                  cursor: srsProcess.checking ? 'not-allowed' : 'pointer',
                  fontWeight: 'bold',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                  opacity: srsProcess.checking ? 0.3 : 1
                }}
              >
                Restart
              </button>
            </div>
          </div>

          {/* Connected Clients */}
          <div style={{ 
            backgroundColor: '#0b1118', 
            border: '1px solid var(--panel-border)', 
            borderRadius: '4px',
            padding: '2rem',
            flex: 1
          }}>
            <h3 style={{ marginTop: 0, color: 'var(--primary)', borderBottom: '1px solid var(--panel-border)', paddingBottom: '0.5rem', marginBottom: '1.5rem' }}>
              Connected Clients ({clients.length})
            </h3>
            
            {clients.length === 0 ? (
              <div style={{ color: 'var(--text-secondary)', fontStyle: 'italic', textAlign: 'center', padding: '2rem 0' }}>
                No clients connected.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--panel-border)', textAlign: 'left', color: 'var(--text-secondary)' }}>
                      <th style={{ padding: '0.5rem' }}>Name</th>
                      <th style={{ padding: '0.5rem' }}>Coalition</th>
                      <th style={{ padding: '0.5rem' }}>Radios</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clients.map((c, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                        <td style={{ padding: '0.75rem 0.5rem', fontFamily: 'var(--font-mono)' }}>{c.Name}</td>
                        <td style={{ padding: '0.75rem 0.5rem' }}>
                          {c.Coalition === 0 ? 'Spectator' : (c.Coalition === 1 ? <span style={{color: '#ff4444'}}>Red</span> : <span style={{color: '#44aaff'}}>Blue</span>)}
                        </td>
                        <td style={{ padding: '0.75rem 0.5rem', fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
                          {c.RadioInfo?.radios ? c.RadioInfo.radios.filter((r: any) => r.freq > 1).map((r: any) => (r.freq/1000000).toFixed(3)).join(', ') : 'N/A'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Settings */}
        <div style={{ 
          flex: 2, 
          minWidth: '400px',
          backgroundColor: '#0b1118', 
          border: '1px solid var(--panel-border)', 
          borderRadius: '4px',
          padding: '2rem'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--panel-border)', paddingBottom: '0.5rem', marginBottom: '1.5rem' }}>
            <h3 style={{ marginTop: 0, marginBottom: 0, color: 'var(--primary)' }}>Configuration (server.cfg)</h3>
            <button 
              onClick={handleSave} 
              disabled={saving || !settings}
              style={{
                padding: '0.5rem 1rem',
                backgroundColor: 'var(--primary)',
                color: '#000',
                border: 'none',
                borderRadius: '4px',
                cursor: (saving || !settings) ? 'not-allowed' : 'pointer',
                fontWeight: 'bold',
                opacity: (saving || !settings) ? 0.5 : 1
              }}
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
          
          {saveMsg && (
            <div style={{ 
              marginBottom: '1.5rem', 
              padding: '0.75rem', 
              backgroundColor: saveMsg.includes('Error') ? 'rgba(255, 68, 68, 0.1)' : 'rgba(0, 255, 136, 0.1)',
              color: saveMsg.includes('Error') ? '#ff4444' : '#00ff88',
              borderRadius: '4px',
              border: `1px solid ${saveMsg.includes('Error') ? '#ff4444' : '#00ff88'}`
            }}>
              {saveMsg}
            </div>
          )}

          {!settings && !errorMsg ? (
            <div style={{ color: 'var(--text-secondary)' }}>Loading settings...</div>
          ) : settings ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
              {Object.keys(settings).map(section => (
                <div key={section}>
                  <h4 style={{ color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '1rem', borderBottom: '1px dotted rgba(255,255,255,0.1)', paddingBottom: '0.5rem' }}>
                    {section}
                  </h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
                    {Object.entries(settings[section]).map(([key, val]) => (
                      <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{key}</label>
                        {typeof val === 'boolean' ? (
                          <button
                            onClick={() => updateSetting(section, key, !val)}
                            style={{
                              padding: '0.5rem',
                              backgroundColor: val ? 'rgba(0, 255, 136, 0.1)' : 'rgba(255, 255, 255, 0.05)',
                              border: `1px solid ${val ? '#00ff88' : 'var(--panel-border)'}`,
                              color: val ? '#00ff88' : 'var(--text-secondary)',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              textAlign: 'left'
                            }}
                          >
                            {val ? 'TRUE' : 'FALSE'}
                          </button>
                        ) : typeof val === 'number' ? (
                          <input
                            type="number"
                            value={val}
                            onChange={(e) => updateSetting(section, key, parseFloat(e.target.value))}
                            style={{
                              padding: '0.5rem',
                              backgroundColor: 'var(--bg-darker)',
                              border: '1px solid var(--panel-border)',
                              color: '#fff',
                              borderRadius: '4px',
                              fontFamily: 'var(--font-mono)'
                            }}
                          />
                        ) : (
                          <input
                            type={key.toUpperCase().includes('KEY') ? "password" : "text"}
                            value={val as string}
                            onChange={(e) => updateSetting(section, key, e.target.value)}
                            style={{
                              padding: '0.5rem',
                              backgroundColor: 'var(--bg-darker)',
                              border: '1px solid var(--panel-border)',
                              color: '#fff',
                              borderRadius: '4px',
                              fontFamily: 'var(--font-mono)'
                            }}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
