"use client";
import { useEffect, useState, useRef } from 'react';
import { apiFetch } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

interface MissionData {
  currentMission?: string;
  isPaused?: boolean;
  isOffline?: boolean;
  serverInfo?: {
    name: string;
    ip: string;
    port: number;
    maxPlayers: number;
    password: string;
  };
  queue?: string[];
  uploadedMissions?: string[];
}

export default function MissionPage() {
  const [data, setData] = useState<MissionData | null>(null);
  const [serverFiles, setServerFiles] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentFolder, setCurrentFolder] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');
  const [dcsProcess, setDcsProcess] = useState({ running: false, checking: true });
  const [srsProcess, setSrsProcess] = useState({ running: false, checking: true });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initializedFolder = useRef(false);

  // Normalize paths to use forward slashes
  const normalizedServerFiles = serverFiles.map(file => file.replace(/\\/g, '/'));

  // If there's a search query, show a flat list of matching files
  // Otherwise, show the folder structure
  const isSearching = searchQuery.trim().length > 0;
  
  let displayedFolders: string[] = [];
  let displayedFiles: string[] = [];

  if (isSearching) {
    displayedFiles = normalizedServerFiles.filter(file => 
      file.toLowerCase().includes(searchQuery.toLowerCase())
    );
  } else {
    const prefix = currentFolder ? currentFolder + '/' : '';
    const foldersSet = new Set<string>();
    
    normalizedServerFiles.forEach(file => {
      if (file.startsWith(prefix)) {
        const remainder = file.substring(prefix.length);
        const parts = remainder.split('/');
        if (parts.length > 1) {
          foldersSet.add(parts[0]);
        } else {
          displayedFiles.push(file); // keep full path for files
        }
      }
    });
    displayedFolders = Array.from(foldersSet).sort();
    displayedFiles.sort();
  }

  const breadcrumbs = currentFolder ? currentFolder.split('/') : [];

  const fetchMission = () => {
    apiFetch('/api/mission')
      .then(r => r.json())
      .then(setData)
      .catch(console.error);
      
    apiFetch('/api/mission/browse')
      .then(r => r.json())
      .then(d => {
        if (d.success && d.files) {
          setServerFiles(d.files);
          if (!initializedFolder.current && d.files.length > 0) {
            const first = d.files[0].replace(/\\/g, '/');
            const match = first.match(/^(.*\/missions)/i);
            if (match) {
              setCurrentFolder(match[1]);
            } else {
              // fallback if it doesn't contain /missions (unlikely)
              setCurrentFolder('');
            }
            initializedFolder.current = true;
          }
        }
      })
      .catch(console.error);
      
    apiFetch('/api/server/dcs-process')
      .then(r => r.json())
      .then(d => setDcsProcess({ running: d.running, checking: false }))
      .catch(() => setDcsProcess({ running: false, checking: false }));

    apiFetch('/api/server/srs-process')
      .then(r => r.json())
      .then(d => setSrsProcess({ running: d.running, checking: false }))
      .catch(() => setSrsProcess({ running: false, checking: false }));
  };

  useEffect(() => {
    fetchMission();
    const interval = setInterval(fetchMission, 5000);
    return () => clearInterval(interval);
  }, []);

  const sendAction = async (action: string, payload?: Record<string, unknown>) => {
    try {
      await apiFetch('/api/mission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, payload })
      });
      fetchMission();
    } catch (err) {
      console.error(err);
    }
  };

  const manageProcess = (action: 'start' | 'stop' | 'restart') => {
    setDcsProcess(p => ({ ...p, checking: true }));
    apiFetch('/api/server/dcs-process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action })
    })
      .then(r => r.json())
      .then(() => {
        setTimeout(fetchMission, 2000);
      })
      .catch(console.error);
  };

  const manageSrsProcess = (action: 'start' | 'stop' | 'restart') => {
    setSrsProcess(p => ({ ...p, checking: true }));
    apiFetch('/api/server/srs-process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action })
    })
      .then(r => r.json())
      .then(() => {
        setTimeout(fetchMission, 2000);
      })
      .catch(console.error);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadMsg('Uploading...');
    
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await apiFetch('/api/mission/upload', {
        method: 'POST',
        body: formData
      });
      const json = await res.json();
      
      if (!res.ok) throw new Error(json.error);
      
      setUploadMsg('Mission uploaded successfully!');
      setTimeout(() => setUploadMsg(''), 3000);
      fetchMission();
      
    } catch (err: unknown) {
      setUploadMsg(`Error: ${errorMessage(err)}`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <h1>Mission Control</h1>
      <p style={{ color: 'var(--text-secondary)' }}>
        Manage your DCS server queue, upload new mission files, and control playback.
      </p>

      {/* Server Settings Banner */}
      {data?.serverInfo && (
        <div style={{ 
          backgroundColor: 'var(--panel-bg)', 
          border: '1px solid var(--primary)', 
          borderRadius: '4px',
          padding: '1.5rem',
          marginTop: '1rem',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '2rem',
          alignItems: 'center'
        }}>
          <div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '1px' }}>Server Name</div>
            <div style={{ color: '#fff', fontWeight: 'bold', fontSize: '1.2rem', fontFamily: 'var(--font-mono)' }}>{data.serverInfo.name}</div>
          </div>
          <div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '1px' }}>IP Address</div>
            <div style={{ color: '#fff', fontFamily: 'var(--font-mono)' }}>{data.serverInfo.ip}</div>
          </div>
          <div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '1px' }}>Port</div>
            <div style={{ color: '#fff', fontFamily: 'var(--font-mono)' }}>{data.serverInfo.port}</div>
          </div>
          <div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '1px' }}>Max Players</div>
            <div style={{ color: '#fff', fontFamily: 'var(--font-mono)' }}>{data.serverInfo.maxPlayers}</div>
          </div>
          <div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '1px' }}>Password</div>
            <div style={{ color: data.serverInfo.password ? '#ffaa00' : 'var(--success)', fontFamily: 'var(--font-mono)' }}>{data.serverInfo.password || 'None'}</div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '2rem', marginTop: '1.5rem', flexWrap: 'wrap' }}>
        
        {/* Left Column: Server Status & Controls */}
        <div style={{ flex: 1, minWidth: '300px', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          
          {/* DCS Server Process Box */}
          <div style={{ 
            backgroundColor: '#0b1118', 
            border: '1px solid var(--panel-border)', 
            borderRadius: '4px',
            padding: '2rem'
          }}>
            <h3 style={{ marginTop: 0, color: 'var(--primary)', borderBottom: '1px solid var(--panel-border)', paddingBottom: '0.5rem', marginBottom: '1.5rem' }}>DCS Server Process</h3>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2rem' }}>
              <span style={{ color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '1px', fontSize: '12px' }}>Process State</span>
              <strong style={{ 
                color: dcsProcess.checking ? 'var(--text-secondary)' : (dcsProcess.running ? '#00ff88' : '#ff4444'), 
                fontFamily: 'var(--font-mono)' 
              }}>
                {dcsProcess.checking ? 'CHECKING...' : (dcsProcess.running ? 'RUNNING' : 'STOPPED')}
              </strong>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
              <button 
                onClick={() => manageProcess('start')}
                disabled={dcsProcess.running || dcsProcess.checking}
                style={{
                  padding: '0.75rem',
                  backgroundColor: 'rgba(0, 255, 136, 0.1)',
                  border: '1px solid #00ff88',
                  color: '#00ff88',
                  borderRadius: '4px',
                  cursor: (dcsProcess.running || dcsProcess.checking) ? 'not-allowed' : 'pointer',
                  fontWeight: 'bold',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                  opacity: (dcsProcess.running || dcsProcess.checking) ? 0.3 : 1
                }}
              >
                Start
              </button>
              
              <button 
                onClick={() => manageProcess('restart')}
                disabled={!dcsProcess.running || dcsProcess.checking}
                style={{
                  padding: '0.75rem',
                  backgroundColor: 'transparent',
                  border: '1px solid var(--primary)',
                  color: 'var(--primary)',
                  borderRadius: '4px',
                  cursor: (!dcsProcess.running || dcsProcess.checking) ? 'not-allowed' : 'pointer',
                  fontWeight: 'bold',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                  opacity: (!dcsProcess.running || dcsProcess.checking) ? 0.3 : 1
                }}
              >
                Restart
              </button>

              <button 
                onClick={() => manageProcess('stop')}
                disabled={!dcsProcess.running || dcsProcess.checking}
                style={{
                  padding: '0.75rem',
                  backgroundColor: 'rgba(255, 68, 68, 0.1)',
                  border: '1px solid #ff4444',
                  color: '#ff4444',
                  borderRadius: '4px',
                  cursor: (!dcsProcess.running || dcsProcess.checking) ? 'not-allowed' : 'pointer',
                  fontWeight: 'bold',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                  opacity: (!dcsProcess.running || dcsProcess.checking) ? 0.3 : 1
                }}
              >
                Stop
              </button>
            </div>
          </div>

          {/* SRS Server Process Box */}
          <div style={{ 
            backgroundColor: '#0b1118', 
            border: '1px solid var(--panel-border)', 
            borderRadius: '4px',
            padding: '2rem'
          }}>
            <h3 style={{ marginTop: 0, color: 'var(--primary)', borderBottom: '1px solid var(--panel-border)', paddingBottom: '0.5rem', marginBottom: '1.5rem' }}>SRS Server Process</h3>
            
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
                onClick={() => manageSrsProcess('restart')}
                disabled={!srsProcess.running || srsProcess.checking}
                style={{
                  padding: '0.75rem',
                  backgroundColor: 'transparent',
                  border: '1px solid var(--primary)',
                  color: 'var(--primary)',
                  borderRadius: '4px',
                  cursor: (!srsProcess.running || srsProcess.checking) ? 'not-allowed' : 'pointer',
                  fontWeight: 'bold',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                  opacity: (!srsProcess.running || srsProcess.checking) ? 0.3 : 1
                }}
              >
                Restart
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
            </div>
          </div>
          
          {/* Active Mission Details Box */}
          <div style={{ 
            backgroundColor: '#0b1118', 
            border: '1px solid var(--panel-border)', 
            borderRadius: '4px',
            padding: '2rem'
          }}>
            <h3 style={{ marginTop: 0, color: 'var(--primary)', borderBottom: '1px solid var(--panel-border)', paddingBottom: '0.5rem', marginBottom: '1.5rem' }}>DCS Mission Status</h3>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <span style={{ color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '1px', fontSize: '12px' }}>Current Mission</span>
              <strong style={{ color: '#fff', fontFamily: 'var(--font-mono)' }}>{data?.currentMission || 'Loading...'}</strong>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2rem' }}>
              <span style={{ color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '1px', fontSize: '12px' }}>State</span>
              <strong style={{ 
                color: data?.isOffline ? '#ff4444' : (data?.isPaused ? '#ffaa00' : '#00ff88'), 
                fontFamily: 'var(--font-mono)' 
              }}>
                {data ? (data.isOffline ? 'OFFLINE' : (data.isPaused ? 'PAUSED' : 'RUNNING')) : '...'}
              </strong>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <button 
                onClick={() => sendAction(data?.isPaused ? 'resume' : 'pause')}
                disabled={data?.isOffline}
                style={{
                  padding: '1rem',
                  backgroundColor: 'transparent',
                  border: '1px solid var(--primary)',
                  color: 'var(--primary)',
                  borderRadius: '4px',
                  cursor: data?.isOffline ? 'not-allowed' : 'pointer',
                  fontWeight: 'bold',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                  opacity: data?.isOffline ? 0.5 : 1
                }}
              >
                {data?.isPaused ? '▶ Resume' : '⏸ Pause'}
              </button>

              <button 
                onClick={() => sendAction('reload')}
                disabled={data?.isOffline}
                style={{
                  padding: '1rem',
                  backgroundColor: 'rgba(0, 212, 255, 0.1)',
                  border: '1px solid var(--primary)',
                  color: '#fff',
                  borderRadius: '4px',
                  cursor: data?.isOffline ? 'not-allowed' : 'pointer',
                  fontWeight: 'bold',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                  opacity: data?.isOffline ? 0.5 : 1
                }}
              >
                ↻ Reload
              </button>

            </div>
          </div>

          {/* Upload Center */}
          <div style={{ 
            backgroundColor: '#0b1118', 
            border: '1px dashed var(--primary)', 
            borderRadius: '4px',
            padding: '2rem',
            textAlign: 'center'
          }}>
            <h3 style={{ marginTop: 0, color: 'var(--primary)', marginBottom: '1rem' }}>Upload Mission</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '1.5rem' }}>
              Upload a .miz file directly to the server. It will be added to the queue automatically.
            </p>
            
            <input 
              type="file" 
              accept=".miz" 
              ref={fileInputRef}
              onChange={handleFileUpload}
              style={{ display: 'none' }} 
              id="file-upload"
            />
            <label htmlFor="file-upload" style={{
              display: 'inline-block',
              padding: '1rem 2rem',
              backgroundColor: 'var(--primary)',
              color: '#000',
              fontWeight: 'bold',
              textTransform: 'uppercase',
              letterSpacing: '1px',
              borderRadius: '4px',
              cursor: uploading ? 'not-allowed' : 'pointer',
              opacity: uploading ? 0.7 : 1
            }}>
              {uploading ? 'Uploading...' : 'Select .MIZ File'}
            </label>

            {uploadMsg && (
              <div style={{ marginTop: '1rem', color: uploadMsg.startsWith('Error') ? '#ff4444' : 'var(--primary)', fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
                {uploadMsg}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Mission Queue */}
        <div style={{ flex: 2, minWidth: '300px', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          
          {/* Server Rotation List */}
          <div style={{ 
            backgroundColor: '#0b1118', 
            border: '1px solid var(--panel-border)', 
            borderRadius: '4px',
            padding: '2rem',
            display: 'flex',
            flexDirection: 'column',
            maxHeight: '400px'
          }}>
            <h3 style={{ marginTop: 0, color: 'var(--primary)', borderBottom: '1px solid var(--panel-border)', paddingBottom: '0.5rem', marginBottom: '1.5rem' }}>Server Queue</h3>
            
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {(!data?.queue || data.queue.length === 0) ? (
                <div style={{ color: 'var(--text-secondary)', fontStyle: 'italic', padding: '1rem', textAlign: 'center' }}>
                  No missions configured in serverSettings.lua
                </div>
              ) : (
                data.queue.map((missionPath: string, idx: number) => {
                  const filename = missionPath.split('\\').pop()?.split('/').pop() || missionPath;
                  const isCurrent = data.currentMission && (filename === data.currentMission || filename === `${data.currentMission}.miz`);

                  return (
                    <div key={idx} style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: '1rem',
                      padding: '1rem',
                      backgroundColor: isCurrent ? 'rgba(0, 212, 255, 0.1)' : 'rgba(0, 0, 0, 0.3)',
                      border: isCurrent ? '1px solid var(--primary)' : '1px solid var(--panel-border)',
                      borderRadius: '4px'
                    }}>
                      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: '200px' }}>
                        <strong style={{ color: isCurrent ? '#fff' : '#ccc', fontFamily: 'var(--font-mono)', wordBreak: 'break-word' }}>
                          {idx + 1}. {filename}
                        </strong>
                        <span style={{ color: 'var(--text-secondary)', fontSize: '11px', fontFamily: 'var(--font-mono)', marginTop: '4px', wordBreak: 'break-word' }}>
                          {missionPath}
                        </span>
                      </div>

                      {!isCurrent && (
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button 
                            onClick={() => sendAction('load_file', { file_name: missionPath })}
                            style={{
                              padding: '0.5rem 1rem',
                              backgroundColor: 'transparent',
                              border: '1px solid var(--primary)',
                              color: 'var(--primary)',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontWeight: 'bold',
                              textTransform: 'uppercase',
                              fontSize: '11px',
                              whiteSpace: 'nowrap'
                            }}
                          >
                            Run Now
                          </button>
                          <button 
                            onClick={() => sendAction('remove_from_queue', { file_name: missionPath })}
                            style={{
                              padding: '0.5rem 1rem',
                              backgroundColor: 'rgba(255, 68, 68, 0.1)',
                              border: '1px solid #ff4444',
                              color: '#ff4444',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontWeight: 'bold',
                              textTransform: 'uppercase',
                              fontSize: '11px',
                              whiteSpace: 'nowrap'
                            }}
                          >
                            Remove
                          </button>
                        </div>
                      )}
                      {isCurrent && (
                        <span style={{ color: 'var(--primary)', fontWeight: 'bold', fontSize: '11px', textTransform: 'uppercase', marginLeft: '1rem' }}>Active</span>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Uploaded Missions */}
          <div style={{ 
            backgroundColor: '#0b1118', 
            border: '1px solid var(--panel-border)', 
            borderRadius: '4px',
            padding: '2rem',
            display: 'flex',
            flexDirection: 'column',
            maxHeight: '400px'
          }}>
            <h3 style={{ marginTop: 0, color: 'var(--primary)', borderBottom: '1px solid var(--panel-border)', paddingBottom: '0.5rem', marginBottom: '1.5rem' }}>Uploaded Files (Missions/Uploads)</h3>
            
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {(!data?.uploadedMissions || data.uploadedMissions.length === 0) ? (
                <div style={{ color: 'var(--text-secondary)', fontStyle: 'italic', padding: '1rem', textAlign: 'center' }}>
                  No uploaded files found.
                </div>
              ) : (
                data.uploadedMissions.map((missionPath: string, idx: number) => {
                  const filename = missionPath.split('\\').pop()?.split('/').pop() || missionPath;
                  const isCurrent = data.currentMission && (filename === data.currentMission || filename === `${data.currentMission}.miz`);

                  return (
                    <div key={idx} style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: '1rem',
                      padding: '1rem',
                      backgroundColor: isCurrent ? 'rgba(0, 212, 255, 0.1)' : 'rgba(0, 0, 0, 0.3)',
                      border: isCurrent ? '1px solid var(--primary)' : '1px solid var(--panel-border)',
                      borderRadius: '4px'
                    }}>
                      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: '200px' }}>
                        <strong style={{ color: isCurrent ? '#fff' : '#ccc', fontFamily: 'var(--font-mono)', wordBreak: 'break-word' }}>
                          {filename}
                        </strong>
                        <span style={{ color: 'var(--text-secondary)', fontSize: '11px', fontFamily: 'var(--font-mono)', marginTop: '4px', wordBreak: 'break-word' }}>
                          {missionPath}
                        </span>
                      </div>

                      {!isCurrent && (
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button 
                            onClick={() => sendAction('add_to_queue', { file_name: missionPath })}
                            style={{
                              padding: '0.5rem 1rem',
                              backgroundColor: 'rgba(0, 255, 136, 0.1)',
                              border: '1px solid var(--success)',
                              color: 'var(--success)',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontWeight: 'bold',
                              textTransform: 'uppercase',
                              fontSize: '11px',
                              whiteSpace: 'nowrap'
                            }}
                          >
                            Add to Queue
                          </button>
                          <button 
                            onClick={() => sendAction('load_file', { file_name: missionPath })}
                            style={{
                              padding: '0.5rem 1rem',
                              backgroundColor: 'transparent',
                              border: '1px solid var(--primary)',
                              color: 'var(--primary)',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontWeight: 'bold',
                              textTransform: 'uppercase',
                              fontSize: '11px',
                              whiteSpace: 'nowrap'
                            }}
                          >
                            Run Now
                          </button>
                        </div>
                      )}
                      {isCurrent && (
                        <span style={{ color: 'var(--primary)', fontWeight: 'bold', fontSize: '11px', textTransform: 'uppercase', marginLeft: '1rem' }}>Active</span>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

        {/* Server Files Browser */}
          <div style={{ 
            backgroundColor: '#0b1118', 
            border: '1px solid var(--panel-border)', 
            borderRadius: '4px',
            padding: '2rem',
            display: 'flex',
            flexDirection: 'column',
            maxHeight: '400px'
          }}>
            <h3 style={{ marginTop: 0, color: 'var(--primary)', borderBottom: '1px solid var(--panel-border)', paddingBottom: '0.5rem', marginBottom: '1rem' }}>Server Files Browser (Missions/)</h3>
            
            <div style={{ marginBottom: '1rem' }}>
              <input 
                type="text" 
                placeholder="Search missions globally..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px',
                  backgroundColor: 'rgba(0, 0, 0, 0.5)',
                  border: '1px solid var(--panel-border)',
                  color: '#fff',
                  borderRadius: '4px',
                  fontFamily: 'var(--font-mono)',
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
              />
            </div>
            
            {/* Breadcrumbs */}
            {!isSearching && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap', fontFamily: 'var(--font-mono)', fontSize: '13px' }}>
                <span 
                  onClick={() => setCurrentFolder('')}
                  style={{ color: currentFolder === '' ? '#fff' : 'var(--primary)', cursor: currentFolder === '' ? 'default' : 'pointer' }}
                >
                  Root
                </span>
                {breadcrumbs.map((crumb, idx) => {
                  const isLast = idx === breadcrumbs.length - 1;
                  const folderPath = breadcrumbs.slice(0, idx + 1).join('/');
                  return (
                    <span key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>/</span>
                      <span 
                        onClick={() => setCurrentFolder(folderPath)}
                        style={{ color: isLast ? '#fff' : 'var(--primary)', cursor: isLast ? 'default' : 'pointer' }}
                      >
                        {crumb}
                      </span>
                    </span>
                  );
                })}
              </div>
            )}

            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {(!isSearching && displayedFolders.length === 0 && displayedFiles.length === 0) || (isSearching && displayedFiles.length === 0) ? (
                <div style={{ color: 'var(--text-secondary)', fontStyle: 'italic', padding: '1rem', textAlign: 'center' }}>
                  {serverFiles.length > 0 ? (isSearching ? 'No files match your search.' : 'Empty folder.') : 'No extra .miz files found on server.'}
                </div>
              ) : (
                <>
                  {/* Render Folders */}
                  {!isSearching && displayedFolders.map((folder, idx) => (
                    <div 
                      key={`folder-${idx}`} 
                      onClick={() => setCurrentFolder(currentFolder ? `${currentFolder}/${folder}` : folder)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '1rem',
                        padding: '1rem',
                        backgroundColor: 'rgba(0, 0, 0, 0.3)',
                        border: '1px solid var(--panel-border)',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        transition: 'background-color 0.2s'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(0, 212, 255, 0.05)'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.3)'}
                    >
                      <span style={{ color: 'var(--primary)', fontSize: '1.2rem' }}>📁</span>
                      <strong style={{ color: '#fff', fontFamily: 'var(--font-mono)' }}>{folder}</strong>
                    </div>
                  ))}

                  {/* Render Files */}
                  {displayedFiles.map((missionPath: string, idx: number) => {
                    const filename = missionPath.split('/').pop() || missionPath;
                    const isCurrent = data?.currentMission && (filename === data.currentMission || filename === `${data.currentMission}.miz`);

                    return (
                      <div key={`file-${idx}`} style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: '1rem',
                        padding: '1rem',
                        backgroundColor: isCurrent ? 'rgba(0, 212, 255, 0.1)' : 'rgba(0, 0, 0, 0.3)',
                        border: isCurrent ? '1px solid var(--primary)' : '1px solid var(--panel-border)',
                        borderRadius: '4px'
                      }}>
                        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: '200px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{ color: 'var(--text-secondary)' }}>📄</span>
                            <strong style={{ color: isCurrent ? '#fff' : '#ccc', fontFamily: 'var(--font-mono)', wordBreak: 'break-word' }}>
                              {filename}
                            </strong>
                          </div>
                          {isSearching && (
                            <span style={{ color: 'var(--text-secondary)', fontSize: '11px', fontFamily: 'var(--font-mono)', marginTop: '4px', wordBreak: 'break-word', marginLeft: '1.5rem' }}>
                              {missionPath}
                            </span>
                          )}
                        </div>

                        {!isCurrent && (
                          <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button 
                              onClick={() => sendAction('add_to_queue', { file_name: missionPath })}
                              style={{
                                padding: '0.5rem 1rem',
                                backgroundColor: 'rgba(0, 255, 136, 0.1)',
                                border: '1px solid var(--success)',
                                color: 'var(--success)',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontWeight: 'bold',
                                textTransform: 'uppercase',
                                fontSize: '11px',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              Add to Queue
                            </button>
                            <button 
                              onClick={() => sendAction('load_file', { file_name: missionPath })}
                              style={{
                                padding: '0.5rem 1rem',
                                backgroundColor: 'transparent',
                                border: '1px solid var(--primary)',
                                color: 'var(--primary)',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontWeight: 'bold',
                                textTransform: 'uppercase',
                                fontSize: '11px',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              Run Now
                            </button>
                          </div>
                        )}
                        {isCurrent && (
                          <span style={{ color: 'var(--primary)', fontWeight: 'bold', fontSize: '11px', textTransform: 'uppercase', marginLeft: '1rem' }}>Active</span>
                        )}
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
