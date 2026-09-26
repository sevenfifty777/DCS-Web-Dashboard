"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api';
import styles from '../page.module.css';
import { errorMessage } from '@/lib/errors';

// --- API shapes --------------------------------------------------------------

/** One line of the DCS server chat log, as served by `GET /api/chat/history`. */
interface ChatMessage {
  /** Mission absolute time, seconds since mission midnight. */
  time: number;
  /** 0 neutral/system, 1 red, 2 blue. */
  coalition: number;
  /** Empty for system lines (Tacview, scripts using `net.recv_chat`). */
  name: string;
  message: string;
}

/** One scripted on-screen message, as served by `GET /api/screen-messages`. */
interface ScreenMessage {
  id: number;
  time: number;
  scope: 'all' | 'coalition' | 'country' | 'group' | 'unit';
  target?: number;
  text: string;
  duration: number;
  clear_view: boolean;
}

interface CursorResponse<T> {
  messages: T[];
  last: number;
}

// --- tuning ------------------------------------------------------------------

/** Chat and screen-message polls while the page is open. */
const FEED_POLL_MS = 3000;
/** Lines kept per feed in the browser; older ones are dropped from the top. */
const MAX_FEED_LINES = 500;
/** "Stick to bottom" tolerance when new lines arrive. */
const AUTOSCROLL_SLACK_PX = 40;

// --- helpers -----------------------------------------------------------------

function formatMissionTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds)) % 86400;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
}

function coalitionColor(coalition: number): string {
  switch (coalition) {
    case 1: return 'var(--danger)';
    case 2: return 'var(--primary)';
    default: return 'var(--text-dim)';
  }
}

function isSystemLine(line: ChatMessage): boolean {
  return line.name.trim() === '';
}

type Keyed<T> = T & { key: number };

/**
 * Poll a cursor endpoint (`?from=N` → `{ messages, last }`) and accumulate the
 * lines. A `last` below our cursor means DCS restarted and the log started
 * over: the feed is cleared and, if the server did not already send the whole
 * buffer, re-read from the top.
 */
function useCursorFeed<T>(path: string, intervalMs: number) {
  const [items, setItems] = useState<Keyed<T>[]>([]);
  const [error, setError] = useState('');
  const cursorRef = useRef(0);
  const keyRef = useRef(1);
  const inFlightRef = useRef(false);

  const poll = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      // At most two round trips: the normal one, plus a re-read from the top
      // when the log shrank (DCS restarted) and the server sent nothing back.
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await apiFetch(`${path}?from=${cursorRef.current}`);
        const data = await res.json();
        if (!res.ok) {
          setError(data?.error || `${path} failed (${res.status})`);
          return;
        }
        const body = data as CursorResponse<T>;
        setError('');
        const restarted = body.last < cursorRef.current;
        if (restarted) setItems([]);
        if (body.messages.length > 0) {
          const lines = body.messages.map((m) => ({ ...m, key: keyRef.current++ }));
          setItems((prev) => (restarted ? lines : [...prev, ...lines]).slice(-MAX_FEED_LINES));
        }
        cursorRef.current = restarted && body.messages.length === 0 ? 0 : body.last;
        if (cursorRef.current !== 0 || !restarted) return;
      }
    } catch (err: unknown) {
      setError(errorMessage(err));
    } finally {
      inFlightRef.current = false;
    }
  }, [path]);

  useEffect(() => {
    poll();
    const timer = setInterval(poll, intervalMs);
    return () => clearInterval(timer);
  }, [poll, intervalMs]);

  const clear = useCallback(() => setItems([]), []);
  return { items, error, refresh: poll, clear };
}

// --- presentational pieces ----------------------------------------------------

const labelStyle: React.CSSProperties = {
  fontSize: '12px', fontWeight: 700, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase'
};
const panelStyle: React.CSSProperties = {
  background: 'var(--card-bg)', border: '1px solid var(--panel-border)', borderRadius: '2px', padding: '15px', minWidth: 0
};
const smallButtonStyle: React.CSSProperties = {
  background: 'transparent', border: '1px solid var(--panel-border)', color: 'var(--text-dim)', padding: '2px 8px',
  borderRadius: '2px', cursor: 'pointer', fontSize: '11px', fontFamily: 'var(--font-mono)', textTransform: 'uppercase'
};
const selectStyle: React.CSSProperties = {
  background: 'var(--background)', border: '1px solid var(--panel-border)', color: 'var(--primary)', padding: '3px 6px',
  fontFamily: 'var(--font-mono)', fontSize: '11px', outline: 'none'
};

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <span style={{ color, border: `1px solid ${color}`, borderRadius: '2px', padding: '0 4px', fontSize: '10px', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', flexShrink: 0, lineHeight: 1.5, alignSelf: 'flex-start', marginTop: '2px' }}>
      {text}
    </span>
  );
}

/** Scrolling feed box that follows the newest line until the user scrolls up. */
function FeedBox({ lines, emptyText }: { lines: React.ReactNode[]; emptyText: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (el && autoScroll) el.scrollTop = el.scrollHeight;
  }, [lines, autoScroll]);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight <= AUTOSCROLL_SLACK_PX);
  };

  return (
    <>
      <div
        ref={ref}
        onScroll={onScroll}
        style={{ height: '420px', overflowY: 'auto', background: 'var(--background)', border: '1px solid var(--panel-border)', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: '4px' }}
      >
        {lines.length === 0 && (
          <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: 'auto', textAlign: 'center' }}>{emptyText}</p>
        )}
        {lines}
      </div>
      {!autoScroll && lines.length > 0 && (
        <button
          type="button"
          onClick={() => { setAutoScroll(true); const el = ref.current; if (el) el.scrollTop = el.scrollHeight; }}
          style={{ marginTop: '6px', background: 'transparent', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: '12px', fontFamily: 'var(--font-mono)', padding: 0 }}
        >
          ↓ Jump to latest
        </button>
      )}
    </>
  );
}

function FeedError({ error }: { error: string }) {
  if (!error) return null;
  return (
    <p style={{ fontSize: '12px', color: 'var(--warning)', fontFamily: 'var(--font-mono)', margin: '0 0 10px 0' }}>
      Feed unavailable: {error}
    </p>
  );
}

// --- screen message classification --------------------------------------------

type ScreenFilter = 'everything' | 'broadcast' | 'red' | 'blue' | 'targeted';

function screenBadge(line: ScreenMessage): { text: string; color: string } {
  switch (line.scope) {
    case 'all': return { text: 'ALL', color: 'var(--success)' };
    case 'coalition':
      if (line.target === 1) return { text: 'RED', color: 'var(--danger)' };
      if (line.target === 2) return { text: 'BLUE', color: 'var(--primary)' };
      return { text: 'NEUTRAL', color: 'var(--text-dim)' };
    case 'country': return { text: `COUNTRY ${line.target ?? '?'}`, color: 'var(--text-dim)' };
    case 'group': return { text: `GROUP ${line.target ?? '?'}`, color: 'var(--warning)' };
    case 'unit': return { text: `UNIT ${line.target ?? '?'}`, color: 'var(--warning)' };
  }
}

function matchesFilter(line: ScreenMessage, filter: ScreenFilter): boolean {
  switch (filter) {
    case 'everything': return true;
    case 'broadcast': return line.scope === 'all';
    case 'red': return line.scope === 'all' || (line.scope === 'coalition' && line.target === 1);
    case 'blue': return line.scope === 'all' || (line.scope === 'coalition' && line.target === 2);
    case 'targeted': return line.scope === 'group' || line.scope === 'unit' || line.scope === 'country';
  }
}

// --- page ----------------------------------------------------------------------

export default function Chat() {
  const [message, setMessage] = useState('');
  const [coalition, setCoalition] = useState('COALITION_ALL');
  const [status, setStatus] = useState('');
  const [isAnnouncement, setIsAnnouncement] = useState(false);
  const [displayTime, setDisplayTime] = useState(10);

  const [showSystem, setShowSystem] = useState(true);
  const [screenFilter, setScreenFilter] = useState<ScreenFilter>('everything');

  const chat = useCursorFeed<ChatMessage>('/api/chat/history', FEED_POLL_MS);
  const screen = useCursorFeed<ScreenMessage>('/api/screen-messages', FEED_POLL_MS);

  const sendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('Sending...');
    try {
      const endpoint = isAnnouncement ? '/api/announcements' : '/api/chat';
      const payload = isAnnouncement
        ? { message, coalition: coalition === 'COALITION_ALL' ? 'ALL' : coalition, display_time: displayTime }
        : { message, coalition };

      const res = await apiFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        setStatus('Message sent!');
        setMessage('');
        setTimeout(() => setStatus(''), 3000);
        // Both kinds land in a server-side log; pick them up right away.
        void (isAnnouncement ? screen.refresh() : chat.refresh());
      } else {
        setStatus(`Error: ${data.error}`);
      }
    } catch (err: unknown) {
      setStatus(`Error: ${errorMessage(err)}`);
    }
  };

  // Chat panel lines.
  const chatLines = (showSystem ? chat.items : chat.items.filter((l) => !isSystemLine(l))).map((line) => {
    const system = isSystemLine(line);
    return (
      <div key={line.key} style={{ display: 'flex', gap: '10px', alignItems: 'baseline', fontSize: '13px', lineHeight: 1.4 }}>
        <span style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: '11px', flexShrink: 0 }}>
          {formatMissionTime(line.time)}
        </span>
        <span style={{ color: coalitionColor(line.coalition), fontWeight: 700, flexShrink: 0, fontStyle: system ? 'italic' : 'normal' }}>
          {system ? 'SYSTEM' : line.name}
        </span>
        <span style={{ color: system ? 'var(--text-muted)' : 'var(--foreground)', fontStyle: system ? 'italic' : 'normal', wordBreak: 'break-word' }}>
          {line.message}
        </span>
      </div>
    );
  });

  // Screen panel lines.
  const screenNodes = screen.items.filter((l) => matchesFilter(l, screenFilter)).map((line) => {
    const badge = screenBadge(line);
    return (
      <div key={line.key} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', fontSize: '13px', lineHeight: 1.4 }}>
        <span style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: '11px', flexShrink: 0, paddingTop: '2px' }}>
          {formatMissionTime(line.time)}
        </span>
        <Badge text={badge.text} color={badge.color} />
        <span style={{ color: 'var(--foreground)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', flex: 1 }}>
          {line.text}
        </span>
        <span style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: '10px', flexShrink: 0, paddingTop: '2px' }} title="Display time">
          {line.duration > 0 ? `${Math.round(line.duration)}s` : ''}
        </span>
      </div>
    );
  });

  return (
    <main className={styles.main}>
      <h1>Server Chat / Announcements</h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '20px' }}>
        {/* --- Live chat ------------------------------------------------ */}
        <div style={panelStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '10px' }}>
            <span style={labelStyle}>Live Chat</span>
            <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-dim)', cursor: 'pointer' }}>
                <input type="checkbox" checked={showSystem} onChange={(e) => setShowSystem(e.target.checked)} style={{ accentColor: 'var(--primary)' }} />
                Show system messages
              </label>
              <button type="button" onClick={chat.clear} style={smallButtonStyle}>Clear</button>
            </div>
          </div>
          <FeedError error={chat.error} />
          <FeedBox lines={chatLines} emptyText={chat.error ? 'Waiting for the DCS server...' : 'No chat messages yet.'} />
        </div>

        {/* --- On-screen messages --------------------------------------- */}
        <div style={panelStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '10px' }}>
            <span style={labelStyle}>Screen Messages</span>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <select value={screenFilter} onChange={(e) => setScreenFilter(e.target.value as ScreenFilter)} style={selectStyle}>
                <option value="everything">Everything</option>
                <option value="broadcast">Broadcast only</option>
                <option value="red">Red sees</option>
                <option value="blue">Blue sees</option>
                <option value="targeted">Group / unit / country</option>
              </select>
              <button type="button" onClick={screen.clear} style={smallButtonStyle}>Clear</button>
            </div>
          </div>
          <FeedError error={screen.error} />
          <FeedBox
            lines={screenNodes}
            emptyText={screen.error ? 'Waiting for the DCS server...' : 'No on-screen messages since the capture was installed in this mission.'}
          />
        </div>
      </div>

      {/* --- Send form ---------------------------------------------------- */}
      <div style={panelStyle}>
        <form onSubmit={sendChat} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <label style={labelStyle}>Target Coalition</label>
            <select
              value={coalition}
              onChange={(e) => setCoalition(e.target.value)}
              style={{ background: 'var(--background)', border: '1px solid var(--panel-border)', color: 'var(--primary)', padding: '10px', fontFamily: 'var(--font-mono)', fontSize: '14px', outline: 'none' }}
            >
              <option value="COALITION_ALL">All Players</option>
              <option value="COALITION_RED">Red Team</option>
              <option value="COALITION_BLUE">Blue Team</option>
              <option value="COALITION_NEUTRAL">Neutral</option>
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <label style={labelStyle}>Message</label>
            <input
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Enter message to broadcast..."
              required
              style={{ background: 'var(--background)', border: '1px solid var(--panel-border)', color: 'var(--foreground)', padding: '10px', fontFamily: 'var(--font-ui)', fontSize: '14px', outline: 'none' }}
            />
          </div>

          <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: 'var(--text-dim)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={isAnnouncement}
                onChange={(e) => setIsAnnouncement(e.target.checked)}
                style={{ accentColor: 'var(--primary)' }}
              />
              Send as Screen Text (Announcement)
            </label>

            {isAnnouncement && (
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: 'var(--text-dim)' }}>
                Display Time (s):
                <input
                  type="number"
                  value={displayTime}
                  onChange={(e) => setDisplayTime(parseInt(e.target.value) || 10)}
                  min="1" max="60"
                  style={{ width: '60px', background: 'var(--background)', border: '1px solid var(--panel-border)', color: 'var(--foreground)', padding: '5px', outline: 'none' }}
                />
              </label>
            )}
          </div>

          <button
            type="submit"
            style={{ marginTop: '10px', padding: '10px', background: 'transparent', border: '1px solid var(--success)', color: 'var(--success)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', fontWeight: 700, cursor: 'pointer', letterSpacing: '1px', transition: 'all 0.2s' }}
            onMouseOver={(e) => { e.currentTarget.style.background = 'rgba(57, 211, 83, 0.1)'; }}
            onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            Send Broadcast
          </button>
          {status && <p style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{status}</p>}
        </form>
      </div>
    </main>
  );
}
