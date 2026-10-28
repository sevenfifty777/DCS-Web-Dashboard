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

function timeOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function AiChat({ lines, onSend, disabled }: { lines: ChatLine[]; onSend: (text: string) => Promise<void>; disabled: boolean }) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState('');
  const [showDetail, setShowDetail] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
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
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-dim)', cursor: 'pointer' }}>
          <input type="checkbox" checked={showDetail} onChange={(e) => setShowDetail(e.target.checked)} style={{ accentColor: 'var(--primary)' }} />
          Show reasoning and tool calls
        </label>
      </div>
      <div
        ref={boxRef}
        onScroll={onScroll}
        style={{ height: '460px', overflowY: 'auto', background: 'var(--background)', border: '1px solid var(--panel-border)', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: '6px' }}
      >
        {visible.length === 0 && (
          <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: 'auto', textAlign: 'center' }}>No orders yet. Tell the commander what you want.</p>
        )}
        {visible.map((line) => {
          const k = kindStyle(line.kind);
          return (
            <div key={line.id} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', fontSize: '13px', lineHeight: 1.45, opacity: k.dim ? 0.8 : 1 }}>
              <span style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: '11px', flexShrink: 0, paddingTop: '2px' }}>{timeOf(line.created_at)}</span>
              <span style={{ color: k.color, border: `1px solid ${k.color}`, borderRadius: '2px', padding: '0 4px', fontSize: '10px', fontFamily: 'var(--font-mono)', flexShrink: 0, marginTop: '2px' }}>{k.label}</span>
              <span style={{ color: 'var(--foreground)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontStyle: k.italic ? 'italic' : 'normal', flex: 1 }}>
                {line.kind === 'order' ? <strong>{line.author}: </strong> : null}{line.text}
              </span>
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
