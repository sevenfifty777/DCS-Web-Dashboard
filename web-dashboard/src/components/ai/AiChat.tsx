"use client";
import { useEffect, useRef, useState } from 'react';
import type { ChatLine } from '@/lib/ai';
import { errorMessage } from '@/lib/errors';

const panelStyle: React.CSSProperties = {
  background: 'var(--card-bg)', border: '1px solid var(--panel-border)', borderRadius: '2px', padding: '15px', minWidth: 0,
};
const labelStyle: React.CSSProperties = {
  fontSize: '12px', fontWeight: 700, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase',
};
const smallButtonStyle: React.CSSProperties = {
  background: 'transparent', border: '1px solid var(--panel-border)', borderRadius: '2px', color: 'var(--text-dim)',
  padding: '3px 8px', cursor: 'pointer', fontSize: '11px', fontFamily: 'var(--font-mono)', textTransform: 'uppercase',
};
const AUTOSCROLL_SLACK_PX = 40;

function kindStyle(kind: string): { color: string; label: string; italic?: boolean; dim?: boolean } {
  switch (kind) {
    case 'order': return { color: 'var(--primary)', label: 'ORDER' };
    case 'sitrep': return { color: 'var(--success, #3fb950)', label: 'SITREP' };
    case 'thinking': return { color: 'var(--text-dim)', label: 'THINK', italic: true, dim: true };
    case 'progress': return { color: 'var(--text-dim)', label: 'NOTE', dim: true };
    case 'tool': return { color: 'var(--warning)', label: 'TOOL', dim: true };
    case 'approval': return { color: 'var(--warning)', label: 'APPROVAL' };
    case 'announce': return { color: 'var(--primary)', label: 'TO PLAYERS' };
    default: return { color: 'var(--text-muted)', label: kind.toUpperCase(), italic: true };
  }
}

/** Local calendar day of a line, used to group the transcript and to decide the stamp. */
function dayOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString([], { weekday: 'short', day: '2-digit', month: 'long', year: 'numeric' });
}

/** Compact stamp: "01 Nov 13:56:00"; the full local date and time sits in the tooltip. */
function stampOf(iso: string): { short: string; full: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { short: '', full: '' };
  const date = d.toLocaleDateString([], { day: '2-digit', month: 'short' });
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return { short: `${date} ${time}`, full: d.toLocaleString() };
}

export function AiChat({ lines, onSend, onClear, onReset, onShowAll, hiddenHistory, disabled }: {
  lines: ChatLine[];
  onSend: (text: string) => Promise<void>;
  /** Hide everything shown so far on this browser only; the commander keeps its memory. */
  onClear: () => Promise<void>;
  /** Ask the service to archive the commander's conversation, then clear the view. */
  onReset: () => Promise<void>;
  /** Undo a clear: show the whole transcript again. */
  onShowAll: () => Promise<void>;
  hiddenHistory: boolean;
  disabled: boolean;
}) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState('');
  const [showDetail, setShowDetail] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  const visible = showDetail ? lines : lines.filter((l) => !['thinking', 'tool', 'progress'].includes(l.kind));

  useEffect(() => {
    const el = boxRef.current;
    if (el && autoScroll) el.scrollTop = el.scrollHeight;
  }, [visible.length, autoScroll]);

  const onScroll = () => {
    const el = boxRef.current;
    if (!el) return;
    setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight <= AUTOSCROLL_SLACK_PX);
  };

  const run = async (label: string, action: () => Promise<void>, done: string) => {
    setBusy(true);
    setStatus(label);
    try {
      await action();
      setStatus(done);
      setTimeout(() => setStatus(''), 6000);
    } catch (err: unknown) {
      setStatus(`Error: ${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const clear = () => run('Clearing the view...', onClear, 'View cleared. Older lines stay in the Decision log; "Show all" brings them back.');

  const reset = () => {
    if (!window.confirm('Reset the commander\'s conversation?\n\nIt forgets everything said so far and starts fresh at the next order. The transcript stays in the Decision log.')) return;
    void run('Resetting the commander...', onReset, 'Reset requested. The commander starts over at its next wake; send an order to begin.');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const order = text.trim();
    if (!order) return;
    setStatus('Sending order...');
    try {
      await onSend(order);
      setText('');
      setStatus('Queued. The commander will answer with a SITREP.');
      setTimeout(() => setStatus(''), 4000);
    } catch (err: unknown) {
      setStatus(`Error: ${errorMessage(err)}`);
    }
  };

  return (
    <div style={panelStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', gap: '10px', flexWrap: 'wrap' }}>
        <span style={labelStyle}>Commander transcript</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-dim)', cursor: 'pointer' }}>
            <input type="checkbox" checked={showDetail} onChange={(e) => setShowDetail(e.target.checked)} style={{ accentColor: 'var(--primary)' }} />
            Show reasoning and tool calls
          </label>
          {hiddenHistory ? (
            <button type="button" onClick={() => void run('Loading...', onShowAll, '')} disabled={busy} style={smallButtonStyle} title="Show the whole transcript again">
              Show all
            </button>
          ) : (
            <button type="button" onClick={() => void clear()} disabled={busy || lines.length === 0} style={smallButtonStyle} title="Hide the lines shown so far on this browser; the commander keeps its memory">
              Clear view
            </button>
          )}
          <button type="button" onClick={reset} disabled={busy || disabled} style={{ ...smallButtonStyle, color: 'var(--danger)', borderColor: 'var(--danger)' }}
            title="Archive the commander's conversation so it starts fresh at its next wake">
            Reset commander
          </button>
        </div>
      </div>
      <div
        ref={boxRef}
        onScroll={onScroll}
        style={{ height: '460px', overflowY: 'auto', background: 'var(--background)', border: '1px solid var(--panel-border)', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: '6px' }}
      >
        {visible.length === 0 && (
          <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: 'auto', textAlign: 'center' }}>
            {hiddenHistory ? 'Older lines are hidden. New orders and answers appear here.' : 'No orders yet. Tell the commander what you want.'}
          </p>
        )}
        {visible.map((line, i) => {
          const k = kindStyle(line.kind);
          const stamp = stampOf(line.created_at);
          const day = dayOf(line.created_at);
          const newDay = day !== '' && day !== (i > 0 ? dayOf(visible[i - 1].created_at) : '');
          return (
            <div key={line.id}>
              {newDay && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '6px 0 8px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: '11px', textTransform: 'uppercase' }}>
                  <span style={{ flex: 1, borderTop: '1px solid var(--panel-border)' }} />
                  {day}
                  <span style={{ flex: 1, borderTop: '1px solid var(--panel-border)' }} />
                </div>
              )}
              <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', fontSize: '13px', lineHeight: 1.45, opacity: k.dim ? 0.8 : 1 }}>
                <span title={stamp.full} style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: '11px', flexShrink: 0, paddingTop: '2px', whiteSpace: 'nowrap' }}>{stamp.short}</span>
                <span style={{ color: k.color, border: `1px solid ${k.color}`, borderRadius: '2px', padding: '0 4px', fontSize: '10px', fontFamily: 'var(--font-mono)', flexShrink: 0, marginTop: '2px' }}>{k.label}</span>
                <span style={{ color: 'var(--foreground)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontStyle: k.italic ? 'italic' : 'normal', flex: 1 }}>
                  {line.kind === 'order' ? <strong>{line.author}: </strong> : null}{line.text}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      {!autoScroll && visible.length > 0 && (
        <button type="button" onClick={() => { setAutoScroll(true); const el = boxRef.current; if (el) el.scrollTop = el.scrollHeight; }}
          style={{ marginTop: '6px', background: 'transparent', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: '12px', fontFamily: 'var(--font-mono)', padding: 0 }}>
          ↓ Jump to latest
        </button>
      )}
      <form onSubmit={submit} style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Give an order, e.g. “Report the situation” or “Set up a red armour push on Kutaisi in 20 minutes”"
          disabled={disabled}
          maxLength={4000}
          style={{ flex: 1, background: 'var(--background)', border: '1px solid var(--panel-border)', color: 'var(--foreground)', padding: '8px 10px', fontSize: '13px', outline: 'none' }}
        />
        <button type="submit" disabled={disabled || !text.trim()}
          style={{ background: 'var(--primary)', color: 'var(--background)', border: 'none', borderRadius: '2px', padding: '8px 14px', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: '12px', textTransform: 'uppercase', fontWeight: 700 }}>
          Send
        </button>
      </form>
      {status && <p style={{ fontSize: '12px', color: status.startsWith('Error') ? 'var(--warning)' : 'var(--text-dim)', fontFamily: 'var(--font-mono)', margin: '8px 0 0' }}>{status}</p>}
    </div>
  );
}
