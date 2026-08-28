"use client";
import { useCallback, useEffect, useReducer, useState } from 'react';
import { apiFetch } from '@/lib/api';
import {
  hasApiError,
  INITIAL_SRS_CLIENTS_STATE,
  parseSrsClientsResponse,
  reduceSrsClientsState,
  SRS_CLIENTS_UNAVAILABLE_MESSAGE,
} from './srsState';

type SrsSettingValue = boolean | number | string;
type SrsSettings = Record<string, Record<string, SrsSettingValue>>;

interface SrsProcessResponse {
  running: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSrsSettings(value: unknown): value is SrsSettings {
  if (!isRecord(value)) return false;

  return Object.values(value).every((section) => (
    isRecord(section)
    && Object.values(section).every((setting) => (
      typeof setting === 'boolean'
      || typeof setting === 'number'
      || typeof setting === 'string'
    ))
  ));
}

function isSrsProcessResponse(value: unknown): value is SrsProcessResponse {
  return isRecord(value) && typeof value.running === 'boolean';
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

async function responseError(response: Response, fallback: string): Promise<string> {
  const payload: unknown = await response.json().catch(() => null);
  return isRecord(payload) && typeof payload.error === 'string' ? payload.error : fallback;
}

export default function SrsPage() {
  const [settings, setSettings] = useState<SrsSettings | null>(null);
  const [clientsState, dispatchClients] = useReducer(
    reduceSrsClientsState,
    INITIAL_SRS_CLIENTS_STATE,
  );
  const [serverVersion, setServerVersion] = useState<string>('');
  const [srsProcess, setSrsProcess] = useState({ running: false, checking: true });
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [settingsError, setSettingsError] = useState('');
  const [processError, setProcessError] = useState('');

  const fetchSrsClients = useCallback(async () => {
    try {
      const response = await apiFetch('/api/srs/clients');
      const payload: unknown = await response.json();
      if (!response.ok || hasApiError(payload)) {
        throw new Error(SRS_CLIENTS_UNAVAILABLE_MESSAGE);
      }

      const data = parseSrsClientsResponse(payload);
      if (!data) {
        throw new Error(SRS_CLIENTS_UNAVAILABLE_MESSAGE);
      }

      dispatchClients({ type: 'success', clients: data.Clients });
      if (data.ServerVersion) setServerVersion(data.ServerVersion);
    } catch {
      dispatchClients({ type: 'failure', message: SRS_CLIENTS_UNAVAILABLE_MESSAGE });
    }
  }, []);

  const fetchSrsProcess = useCallback(async () => {
    try {
      const response = await apiFetch('/api/server/srs-process');
      const payload: unknown = await response.json();
      if (!response.ok || !isSrsProcessResponse(payload)) throw new Error('Invalid response');
      setSrsProcess({ running: payload.running, checking: false });
      setProcessError('');
    } catch {
      setSrsProcess({ running: false, checking: false });
      setProcessError('SRS process status is temporarily unavailable.');
    }
  }, []);

  const fetchSrsData = useCallback(() => {
    void fetchSrsClients();
    void fetchSrsProcess();
  }, [fetchSrsClients, fetchSrsProcess]);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const response = await apiFetch('/api/srs/settings');
        const payload: unknown = await response.json();
        if (!response.ok || hasApiError(payload) || !isSrsSettings(payload)) {
          throw new Error('SRS settings are temporarily unavailable.');
        }

        setSettings(payload);
        setSettingsError('');
      } catch (error: unknown) {
        setSettingsError(errorMessage(error, 'SRS settings are temporarily unavailable.'));
      }
    };

    void fetchSettings();
    const initialFetch = window.setTimeout(fetchSrsData, 0);
    const interval = setInterval(fetchSrsData, 5000);
    return () => {
      clearTimeout(initialFetch);
      clearInterval(interval);
    };
  }, [fetchSrsData]);

  const manageSrsProcess = async (action: 'start' | 'stop' | 'restart') => {
    setSrsProcess(p => ({ ...p, checking: true }));
    setProcessError('');
    try {
      const response = await apiFetch('/api/server/srs-process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) throw new Error('SRS process action failed.');
      setTimeout(fetchSrsData, 2000);
    } catch (error: unknown) {
      setSrsProcess(p => ({ ...p, checking: false }));
      setProcessError(errorMessage(error, 'SRS process action failed.'));
    }
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
          throw new Error(await responseError(res, 'Failed to save'));
      }
      setSaveMsg('Settings saved successfully!');
    } catch (error: unknown) {
      setSaveMsg(`Error: ${errorMessage(error, 'Failed to save')}`);
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(''), 3000);
    }
  };

  const updateSetting = (section: string, key: string, value: SrsSettingValue) => {
    setSettings((previous) => previous ? ({
      ...previous,
      [section]: {
        ...previous[section],
        [key]: value,
      },
    }) : previous);
  };

  const clients = clientsState.clients;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <h1>SRS Management</h1>
      <p style={{ color: 'var(--text-secondary)' }}>
        Manage SimpleRadio Standalone server process, settings, and view connected players.
      </p>

      {settingsError && (
        <div style={{ backgroundColor: 'rgba(255,68,68,0.1)', border: '1px solid #ff4444', color: '#ff4444', padding: '1rem', borderRadius: '4px', marginBottom: '1rem' }}>
          {settingsError}
        </div>
      )}

      {clientsState.error && (
        <div style={{ backgroundColor: 'rgba(255,68,68,0.1)', border: '1px solid #ff4444', color: '#ff4444', padding: '1rem', borderRadius: '4px', marginBottom: '1rem' }}>
          {clientsState.error}
          {clientsState.hasSuccessfulResult && ' Showing the last successful client list.'}
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

            {processError && (
              <div style={{ color: '#ff4444', marginBottom: '1rem' }}>
                {processError}
              </div>
            )}

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
            
            {!clientsState.hasSuccessfulResult ? (
              <div style={{ color: 'var(--text-secondary)', fontStyle: 'italic', textAlign: 'center', padding: '2rem 0' }}>
                {clientsState.error ? 'Connected-client data unavailable.' : 'Loading connected clients...'}
              </div>
            ) : clients.length === 0 ? (
              <div style={{ color: 'var(--text-secondary)', fontStyle: 'italic', textAlign: 'center', padding: '2rem 0' }}>
                No clients connected.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--panel-border)', textAlign: 'left', color: 'var(--text-secondary)' }}>
                      <th style={{ padding: '0.5rem' }}>Name</th>
                      <th style={{ padding: '0.5rem' }}>Unit Type</th>
                      <th style={{ padding: '0.5rem' }}>Coalition</th>
                      <th style={{ padding: '0.5rem' }}>Radios</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clients.map((c, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                        <td style={{ padding: '0.75rem 0.5rem', fontFamily: 'var(--font-mono)' }}>{c.Name}</td>
                        <td style={{ padding: '0.75rem 0.5rem', fontFamily: 'var(--font-mono)' }}>{c.UnitType || 'Unknown'}</td>
                        <td style={{ padding: '0.75rem 0.5rem' }}>
                          {c.Coalition === 0 ? 'Spectator' : (c.Coalition === 1 ? <span style={{color: '#ff4444'}}>Red</span> : <span style={{color: '#44aaff'}}>Blue</span>)}
                        </td>
                        <td style={{ padding: '0.75rem 0.5rem', fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
                          {c.RadioInfo.radios.filter((radio) => radio.freq > 1).map((radio) => (radio.freq / 1_000_000).toFixed(3)).join(', ') || 'N/A'}
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

          {!settings && !settingsError ? (
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
