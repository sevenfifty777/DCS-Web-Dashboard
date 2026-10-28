"use client";
import { useState } from 'react';
import type { AiStatus } from '@/lib/ai';
import { errorMessage } from '@/lib/errors';

const panelStyle: React.CSSProperties = {
  background: 'var(--card-bg)', border: '1px solid var(--panel-border)', borderRadius: '2px', padding: '12px 15px',
  display: 'flex', flexWrap: 'wrap', gap: '18px', alignItems: 'center',
};
const labelStyle: React.CSSProperties = {
  fontSize: '10px', fontWeight: 700, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', display: 'block',
};
const valueStyle: React.CSSProperties = { fontSize: '13px', fontFamily: 'var(--font-mono)', color: 'var(--foreground)' };

function Dot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontFamily: 'var(--font-mono)', color: ok ? 'var(--foreground)' : 'var(--text-dim)' }}>
      <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: ok ? 'var(--success, #3fb950)' : 'var(--danger)', display: 'inline-block' }} />
      {label}
    </span>
  );
}

export function AiStatusBar({ status, error, streamOpen, onToggleKill }: {
  status: AiStatus | null;
  error: string;
  streamOpen: boolean;
  onToggleKill: (on: boolean) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState('');

  const toggle = async () => {
    if (!status) return;
    const next = !status.kill_switch;
    if (next && !window.confirm('Engage the kill switch? The commander will stop changing the mission and only report.')) return;
    setBusy(true);
    try {
      await onToggleKill(next);
      setLocalError('');
    } catch (err: unknown) {
      setLocalError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (!status) {
    return (
      <div style={panelStyle}>
        <span style={{ color: error ? 'var(--warning)' : 'var(--text-muted)', fontSize: '13px' }}>
          {error ? `AI Commander unavailable: ${error}` : 'Connecting to the AI Commander service...'}
        </span>
      </div>
    );
  }

  const h = status.health;
  const spent = status.budget.spent_today_usd.toFixed(2);
  const cap = status.budget.cap_usd.toFixed(0);
  const lastWake = h.last_wake_at ? new Date(h.last_wake_at * 1000).toLocaleTimeString() : 'never';

  return (
    <div style={panelStyle}>
      <div>
        <span style={labelStyle}>Mission</span>
        <span style={valueStyle}>{status.session.mission_name || '—'}{status.session.theatre ? ` · ${status.session.theatre}` : ''}</span>
      </div>
      <div style={{ display: 'flex', gap: '14px' }}>
        <Dot ok={h.grpc_ok} label="DCS-gRPC" />
        <Dot ok={h.events_stream_ok} label="events" />
        <Dot ok={h.units_stream_ok} label="units" />
        <Dot ok={streamOpen} label="live" />
      </div>
      <div>
        <span style={labelStyle}>Commander</span>
        <span style={valueStyle}>{h.loop_state} · {h.api_state}{status.queue_size ? ` · ${status.queue_size} queued` : ''}</span>
      </div>
      <div>
        <span style={labelStyle}>Last wake</span>
        <span style={valueStyle}>{lastWake}{h.last_wake_reason ? ` (${h.last_wake_reason})` : ''}</span>
      </div>
      <div>
        <span style={labelStyle}>Spend today</span>
        <span style={{ ...valueStyle, color: status.budget.remaining_usd <= 0 ? 'var(--danger)' : 'var(--foreground)' }}>${spent} / ${cap}</span>
      </div>
      <div>
        <span style={labelStyle}>Tracking</span>
        <span style={valueStyle}>{status.units_tracked} units · {status.events_total} events · {status.pending_approvals} pending</span>
      </div>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '10px' }}>
        {(error || localError || h.api_error) && (
          <span style={{ color: 'var(--warning)', fontSize: '11px', fontFamily: 'var(--font-mono)' }}>{error || localError || h.api_error}</span>
        )}
        <button
          type="button"
          onClick={toggle}
          disabled={busy}
          style={{
            background: status.kill_switch ? 'var(--danger)' : 'transparent',
            color: status.kill_switch ? 'var(--background)' : 'var(--danger)',
            border: '1px solid var(--danger)', borderRadius: '2px', padding: '6px 12px', cursor: 'pointer',
            fontSize: '11px', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', fontWeight: 700,
          }}
          title={status.kill_switch ? 'Release the kill switch' : 'Stop the commander from changing the mission'}
        >
          {status.kill_switch ? 'Kill switch ON — release' : 'Kill switch'}
        </button>
      </div>
    </div>
  );
}
