"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api';
import styles from '../page.module.css';
import { errorMessage } from '@/lib/errors';

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

interface ChatHistoryResponse {
  messages: ChatMessage[];
  last: number;
}

interface FeedLine extends ChatMessage {
  id: number;
}

/** How often the page asks DCS for new chat lines while it is open. */
const CHAT_POLL_MS = 3000;
/** Lines kept in the browser; older ones are dropped from the top. */
const MAX_FEED_LINES = 500;
/** "Stick to bottom" tolerance when new lines arrive. */
const AUTOSCROLL_SLACK_PX = 40;

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

export default function Chat() {
  const [message, setMessage] = useState('');
  const [coalition, setCoalition] = useState('COALITION_ALL');
  const [status, setStatus] = useState('');

  const [isAnnouncement, setIsAnnouncement] = useState(false);
  const [displayTime, setDisplayTime] = useState(10);

  const [feed, setFeed] = useState<FeedLine[]>([]);
  const [feedError, setFeedError] = useState('');
  const [showSystem, setShowSystem] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);

  // Cursor into the server's chat log and a per-line id counter. Kept in refs
  // so the polling closure never sees a stale value.
  const cursorRef = useRef(0);
  const nextIdRef = useRef(1);
  const inFlightRef = useRef(false);
  const feedRef = useRef<HTMLDivElement | null>(null);

  const pollHistory = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const res = await apiFetch(`/api/chat/history?from=${cursorRef.current}`);
      const data = await res.json();
      if (!res.ok) {
        setFeedError(data?.error || `Chat history request failed (${res.status})`);
        return;
      }
      const history = data as ChatHistoryResponse;
      // A cursor ahead of the server's log means DCS restarted and the log is
      // shorter than what we already have: start over from the top.
      if (history.last < cursorRef.current) {
        cursorRef.current = 0;
        setFeed([]);
        return;
      }
      cursorRef.current = history.last;
      setFeedError('');
      if (history.messages.length > 0) {
        const lines = history.messages.map((m) => ({ ...m, id: nextIdRef.current++ }));
        setFeed((prev) => [...prev, ...lines].slice(-MAX_FEED_LINES));
      }
    } catch (err: unknown) {
      setFeedError(errorMessage(err));
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    pollHistory();
    const timer = setInterval(pollHistory, CHAT_POLL_MS);
    return () => clearInterval(timer);
  }, [pollHistory]);

  // Follow the newest line unless the user has scrolled up to read history.
  useEffect(() => {
    const el = feedRef.current;
    if (el && autoScroll) el.scrollTop = el.scrollHeight;
  }, [feed, showSystem, autoScroll]);

  const onFeedScroll = () => {
    const el = feedRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= AUTOSCROLL_SLACK_PX;
    setAutoScroll(atBottom);
  };

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
        // Chat messages land in the server log; pick them up right away.
        if (!isAnnouncement) void pollHistory();
      } else {
        setStatus(`Error: ${data.error}`);
      }
    } catch (err: unknown) {
      setStatus(`Error: ${errorMessage(err)}`);
    }
  };

  const visibleFeed = showSystem ? feed : feed.filter((l) => !isSystemLine(l));

  const labelStyle: React.CSSProperties = {
    fontSize: '12px', fontWeight: 700, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase'
  };
  const panelStyle: React.CSSProperties = {
    background: 'var(--card-bg)', border: '1px solid var(--panel-border)', borderRadius: '2px', padding: '15px'
  };

  return (
    <main className={styles.main}>
      <h1>Server Chat / Announcements</h1>

      <div style={panelStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '10px' }}>
          <span style={labelStyle}>Live Chat</span>
          <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-dim)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={showSystem}
                onChange={(e) => setShowSystem(e.target.checked)}
                style={{ accentColor: 'var(--primary)' }}
              />
              Show system messages
            </label>
            <button
              type="button"
              onClick={() => setFeed([])}
              style={{ background: 'transparent', border: '1px solid var(--panel-border)', color: 'var(--text-dim)', padding: '2px 8px', borderRadius: '2px', cursor: 'pointer', fontSize: '11px', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}
            >
              Clear
            </button>
          </div>
        </div>

        {feedError && (
          <p style={{ fontSize: '12px', color: 'var(--warning)', fontFamily: 'var(--font-mono)', margin: '0 0 10px 0' }}>
            Chat feed unavailable: {feedError}
          </p>
        )}

        <div
          ref={feedRef}
          onScroll={onFeedScroll}
          style={{ height: '420px', overflowY: 'auto', background: 'var(--background)', border: '1px solid var(--panel-border)', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: '4px' }}
        >
          {visibleFeed.length === 0 && (
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: 'auto' }}>
              {feedError ? 'Waiting for the DCS server...' : 'No chat messages yet.'}
            </p>
          )}
          {visibleFeed.map((line) => {
            const system = isSystemLine(line);
            return (
              <div key={line.id} style={{ display: 'flex', gap: '10px', alignItems: 'baseline', fontSize: '13px', lineHeight: 1.4 }}>
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
          })}
        </div>
        {!autoScroll && visibleFeed.length > 0 && (
          <button
            type="button"
            onClick={() => { setAutoScroll(true); const el = feedRef.current; if (el) el.scrollTop = el.scrollHeight; }}
            style={{ marginTop: '6px', background: 'transparent', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: '12px', fontFamily: 'var(--font-mono)', padding: 0 }}
          >
            ↓ Jump to latest
          </button>
        )}
      </div>

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
