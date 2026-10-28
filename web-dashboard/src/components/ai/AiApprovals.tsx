"use client";
import { useEffect, useState } from 'react';
import type { Approval } from '@/lib/ai';
import { errorMessage } from '@/lib/errors';

const panelStyle: React.CSSProperties = {
  background: 'var(--card-bg)', border: '1px solid var(--panel-border)', borderRadius: '2px', padding: '15px', minWidth: 0,
};
const labelStyle: React.CSSProperties = {
  fontSize: '12px', fontWeight: 700, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase',
};
const buttonBase: React.CSSProperties = {
  border: '1px solid', borderRadius: '2px', padding: '5px 10px', cursor: 'pointer', fontSize: '11px', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', fontWeight: 700, background: 'transparent',
};

function remaining(expiresAt: string, now: number): string {
  if (!now) return '';
  const ms = new Date(expiresAt).getTime() - now;
  if (Number.isNaN(ms)) return '';
  if (ms <= 0) return 'expiring';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, '0')} left`;
}

function ArgsView({ args }: { args: Record<string, unknown> }) {
  const entries = Object.entries(args).filter(([, v]) => v !== null && v !== undefined && v !== '');
  return (
    <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '2px 10px', margin: '6px 0 0', fontSize: '12px' }}>
      {entries.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{k}</dt>
          <dd style={{ margin: 0, color: 'var(--foreground)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: typeof v === 'object' ? 'var(--font-mono)' : undefined }}>
            {typeof v === 'object' ? JSON.stringify(v) : String(v)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function AiApprovals({ items, onResolve }: { items: Approval[]; onResolve: (id: number, decision: 'approved' | 'denied', note?: string) => Promise<void> }) {
  const [now, setNow] = useState(0);
  const [busy, setBusy] = useState<number | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [error, setError] = useState('');

  useEffect(() => {
    const t0 = setTimeout(() => setNow(Date.now()), 0);
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearTimeout(t0);
      clearInterval(t);
    };
  }, []);

  const decide = async (id: number, decision: 'approved' | 'denied') => {
    setBusy(id);
    try {
      await onResolve(id, decision, notes[id]);
      setError('');
    } catch (err: unknown) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={panelStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <span style={labelStyle}>Approval queue</span>
        <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: items.length ? 'var(--warning)' : 'var(--text-dim)' }}>{items.length} pending</span>
      </div>
      {error && <p style={{ fontSize: '12px', color: 'var(--warning)', fontFamily: 'var(--font-mono)', margin: '0 0 8px' }}>{error}</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '560px', overflowY: 'auto' }}>
        {items.length === 0 && (
          <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: '20px 0', textAlign: 'center' }}>Nothing waiting. Mission-changing actions the commander proposes will appear here.</p>
        )}
        {items.map((a) => (
          <div key={a.id} style={{ border: '1px solid var(--warning)', borderRadius: '2px', padding: '10px', background: 'var(--background)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'baseline' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--warning)', fontSize: '13px' }}>#{a.id} {a.tool}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-dim)' }}>{remaining(a.expires_at, now)}</span>
            </div>
            {a.intent && <p style={{ margin: '6px 0 0', fontSize: '13px', color: 'var(--foreground)' }}>{a.intent}</p>}
            <ArgsView args={a.args} />
            <input
              value={notes[a.id] || ''}
              onChange={(e) => setNotes((prev) => ({ ...prev, [a.id]: e.target.value }))}
              placeholder="Optional note for the commander"
              maxLength={500}
              style={{ width: '100%', boxSizing: 'border-box', marginTop: '8px', background: 'var(--card-bg)', border: '1px solid var(--panel-border)', color: 'var(--foreground)', padding: '5px 8px', fontSize: '12px', outline: 'none' }}
            />
            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
              <button type="button" disabled={busy === a.id} onClick={() => decide(a.id, 'approved')} style={{ ...buttonBase, color: 'var(--success, #3fb950)', borderColor: 'var(--success, #3fb950)' }}>Approve</button>
              <button type="button" disabled={busy === a.id} onClick={() => decide(a.id, 'denied')} style={{ ...buttonBase, color: 'var(--danger)', borderColor: 'var(--danger)' }}>Deny</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
