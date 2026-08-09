"use client";
import { useState } from 'react';
import { apiFetch } from '@/lib/api';

export default function ConsolePage() {
  const [lua, setLua] = useState('return trigger.misc.getUserFlag("100")');
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);

  const handleExecute = async () => {
    setLoading(true);
    setResult('Executing...');
    try {
      const res = await apiFetch('/api/console', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lua })
      });
      const data = await res.json();
      if (!res.ok) {
        setResult(`Error: ${data.error}`);
      } else {
        // format JSON nicely if possible
        try {
          const parsed = JSON.parse(data.result);
          setResult(JSON.stringify(parsed, null, 2));
        } catch {
          setResult(data.result);
        }
      }
    } catch (err: any) {
      setResult(`Network Error: ${err.message}`);
    }
    setLoading(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <h1>Live Lua Console</h1>
      <p style={{ color: 'var(--text-secondary)' }}>
        Remotely execute Lua code directly inside the live DCS mission environment. The <code>Eval</code> API must be enabled on the server configuration.
      </p>

      <div style={{ 
        display: 'flex', 
        gap: '1rem', 
        marginTop: '1rem',
        flex: 1,
        minHeight: '400px'
      }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-secondary)', fontWeight: 'bold' }}>Lua Input</label>
          <textarea
            value={lua}
            onChange={e => setLua(e.target.value)}
            style={{
              flex: 1,
              width: '100%',
              padding: '1rem',
              backgroundColor: '#0b1118',
              border: '1px solid var(--panel-border)',
              borderRadius: '4px',
              color: '#fff',
              fontFamily: 'var(--font-mono)',
              fontSize: '14px',
              resize: 'none',
              outline: 'none'
            }}
            spellCheck="false"
          />
          <button 
            onClick={handleExecute}
            disabled={loading || !lua.trim()}
            style={{
              marginTop: '1rem',
              padding: '1rem',
              backgroundColor: 'var(--primary)',
              border: 'none',
              color: '#000',
              borderRadius: '4px',
              cursor: (loading || !lua.trim()) ? 'not-allowed' : 'pointer',
              fontWeight: 'bold',
              textTransform: 'uppercase',
              letterSpacing: '1px',
              opacity: (loading || !lua.trim()) ? 0.5 : 1
            }}
          >
            {loading ? 'Executing...' : 'Execute Lua'}
          </button>
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-secondary)', fontWeight: 'bold' }}>Output</label>
          <div style={{
            flex: 1,
            width: '100%',
            padding: '1rem',
            backgroundColor: '#05080c',
            border: '1px solid var(--panel-border)',
            borderRadius: '4px',
            color: result.startsWith('Error') ? '#ff4444' : 'var(--primary)',
            fontFamily: 'var(--font-mono)',
            fontSize: '13px',
            overflowY: 'auto',
            whiteSpace: 'pre-wrap'
          }}>
            {result || <span style={{ opacity: 0.3 }}>Awaiting execution...</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
