"use client";
import { useCallback, useEffect, useState } from 'react';
import { ai, type LlmCallRow, type ToolCallRow } from '@/lib/ai';
import { errorMessage } from '@/lib/errors';

const panelStyle: React.CSSProperties = {
  background: 'var(--card-bg)', border: '1px solid var(--panel-border)', borderRadius: '2px', padding: '15px', minWidth: 0,
};
const labelStyle: React.CSSProperties = {
  fontSize: '12px', fontWeight: 700, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase',
};
const cell: React.CSSProperties = { padding: '4px 8px', fontSize: '12px', verticalAlign: 'top', borderBottom: '1px solid var(--panel-border)' };
const head: React.CSSProperties = { ...cell, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: '10px', textTransform: 'uppercase', textAlign: 'left' };

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function statusColor(status: string): string {
  if (status === 'ok') return 'var(--success, #3fb950)';
  if (status === 'running') return 'var(--primary)';
  if (status === 'denied' || status === 'expired' || status === 'disabled') return 'var(--warning)';
  return 'var(--danger)';
}

function short(value: unknown, max = 120): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function AiLog({ version }: { version: number }) {
  const [tools, setTools] = useState<ToolCallRow[]>([]);
  const [llm, setLlm] = useState<LlmCallRow[]>([]);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const body = await ai.log(0, 100);
      setTools(body.tool_calls);
      setLlm(body.llm_calls);
      setError('');
    } catch (err: unknown) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(t);
  }, [load, version]);

  const totalCost = llm.reduce((sum, c) => sum + (c.cost_usd || 0), 0);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '20px' }}>
      <div style={panelStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
          <span style={labelStyle}>Tool calls</span>
          <button type="button" onClick={load} style={{ background: 'transparent', border: '1px solid var(--panel-border)', color: 'var(--text-dim)', padding: '2px 8px', borderRadius: '2px', cursor: 'pointer', fontSize: '11px', fontFamily: 'var(--font-mono)' }}>Refresh</button>
        </div>
        {error && <p style={{ fontSize: '12px', color: 'var(--warning)', fontFamily: 'var(--font-mono)' }}>{error}</p>}
        <div style={{ maxHeight: '360px', overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={head}>Time</th><th style={head}>Tool</th><th style={head}>Tier</th><th style={head}>Status</th><th style={head}>Args / result</th></tr></thead>
            <tbody>
              {tools.map((t) => (
                <tr key={t.id} onClick={() => setExpanded(expanded === t.id ? null : t.id)} style={{ cursor: 'pointer' }}>
                  <td style={{ ...cell, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>{when(t.started_at)}</td>
                  <td style={{ ...cell, fontFamily: 'var(--font-mono)', color: 'var(--foreground)' }}>{t.tool}</td>
                  <td style={{ ...cell, color: 'var(--text-dim)' }}>{t.tier}</td>
                  <td style={{ ...cell, color: statusColor(t.status), fontFamily: 'var(--font-mono)' }}>{t.status}</td>
                  <td style={{ ...cell, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', whiteSpace: expanded === t.id ? 'pre-wrap' : 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '320px', wordBreak: 'break-word' }}>
                    {expanded === t.id ? `${JSON.stringify(t.args, null, 1)}\n→ ${typeof t.result === 'string' ? t.result : JSON.stringify(t.result, null, 1)}` : short(t.args)}
                  </td>
                </tr>
              ))}
              {tools.length === 0 && <tr><td style={{ ...cell, color: 'var(--text-muted)' }} colSpan={5}>No tool calls yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <div style={panelStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
          <span style={labelStyle}>Model calls</span>
          <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>last {llm.length}: ${totalCost.toFixed(3)}</span>
        </div>
        <div style={{ maxHeight: '360px', overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={head}>Time</th><th style={head}>Purpose</th><th style={head}>Stop</th><th style={head}>In / cache / out</th><th style={head}>Cost</th><th style={head}>ms</th></tr></thead>
            <tbody>
              {llm.map((c) => (
                <tr key={c.id}>
                  <td style={{ ...cell, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>{when(c.created_at)}</td>
                  <td style={{ ...cell, color: 'var(--foreground)' }}>{c.purpose}</td>
                  <td style={{ ...cell, color: c.error ? 'var(--danger)' : 'var(--text-dim)', fontFamily: 'var(--font-mono)' }} title={c.error || ''}>{c.error ? 'error' : c.stop_reason || ''}</td>
                  <td style={{ ...cell, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{c.input_tokens} / {c.cache_read}r+{c.cache_write}w / {c.output_tokens}</td>
                  <td style={{ ...cell, fontFamily: 'var(--font-mono)', color: 'var(--foreground)' }}>${c.cost_usd.toFixed(4)}</td>
                  <td style={{ ...cell, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>{c.latency_ms}</td>
                </tr>
              ))}
              {llm.length === 0 && <tr><td style={{ ...cell, color: 'var(--text-muted)' }} colSpan={6}>No model calls yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
