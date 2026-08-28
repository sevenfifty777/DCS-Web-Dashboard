"use client";
import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

export default function TriggersPage() {
  const [flag, setFlag] = useState('');
  const [value, setValue] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleGet = async () => {
    setResult(null);
    setError(null);
    if (!flag) return setError('Flag name/number is required');
    
    try {
      const res = await apiFetch(`/api/triggers?flag=${encodeURIComponent(flag)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult(`Flag ${data.flag} is currently set to: ${data.value}`);
    } catch (err: unknown) {
      setError(errorMessage(err));
    }
  };

  const handleSet = async () => {
    setResult(null);
    setError(null);
    if (!flag || value === '') return setError('Flag name/number and value are required');
    
    try {
      const res = await apiFetch(`/api/triggers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flag, value: Number(value) })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult(`Successfully set Flag ${data.flag} to ${data.value}`);
    } catch (err: unknown) {
      setError(errorMessage(err));
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <h1>Mission Flags & Triggers</h1>
      <p style={{ color: 'var(--text-secondary)' }}>
        Get and set DCS User Flags (Mission Flags). This can be used to manually trigger events, spawn units, or alter mission logic remotely without needing to be in-game.
      </p>

      <div style={{ 
        backgroundColor: '#0b1118', 
        border: '1px solid var(--panel-border)', 
        borderRadius: '4px',
        padding: '2rem',
        marginTop: '1rem',
        maxWidth: '500px'
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>Flag Name or Number</label>
            <input 
              type="text" 
              value={flag} 
              onChange={e => setFlag(e.target.value)} 
              placeholder="e.g. 100 or 'spawn_enemy'"
              style={{
                width: '100%',
                padding: '0.75rem',
                backgroundColor: 'rgba(0, 0, 0, 0.5)',
                border: '1px solid var(--panel-border)',
                borderRadius: '4px',
                color: '#fff',
                fontFamily: 'var(--font-mono)'
              }}
            />
          </div>
          
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>Flag Value</label>
            <input 
              type="number" 
              value={value} 
              onChange={e => setValue(e.target.value)} 
              placeholder="e.g. 1"
              style={{
                width: '100%',
                padding: '0.75rem',
                backgroundColor: 'rgba(0, 0, 0, 0.5)',
                border: '1px solid var(--panel-border)',
                borderRadius: '4px',
                color: '#fff',
                fontFamily: 'var(--font-mono)'
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
            <button 
              onClick={handleGet}
              style={{
                flex: 1,
                padding: '0.75rem',
                backgroundColor: 'transparent',
                border: '1px solid var(--primary)',
                color: 'var(--primary)',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: 'bold',
                textTransform: 'uppercase',
                letterSpacing: '1px'
              }}
            >
              Get Value
            </button>
            <button 
              onClick={handleSet}
              style={{
                flex: 1,
                padding: '0.75rem',
                backgroundColor: 'var(--primary)',
                border: 'none',
                color: '#000',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: 'bold',
                textTransform: 'uppercase',
                letterSpacing: '1px'
              }}
            >
              Set Flag
            </button>
          </div>

          {result && (
            <div style={{ marginTop: '1rem', padding: '1rem', backgroundColor: 'rgba(0, 212, 255, 0.1)', border: '1px solid var(--primary)', borderRadius: '4px', color: 'var(--primary)', fontFamily: 'var(--font-mono)' }}>
              ✓ {result}
            </div>
          )}
          
          {error && (
            <div style={{ marginTop: '1rem', padding: '1rem', backgroundColor: 'rgba(255, 68, 68, 0.1)', border: '1px solid #ff4444', borderRadius: '4px', color: '#ff4444', fontFamily: 'var(--font-mono)' }}>
              ✗ {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
