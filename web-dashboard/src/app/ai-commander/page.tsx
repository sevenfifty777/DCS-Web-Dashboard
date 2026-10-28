"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import styles from '../page.module.css';
import { ai, openAiStream, type AiStatus, type Approval, type ChatLine } from '@/lib/ai';
import { errorMessage } from '@/lib/errors';
import { AiStatusBar } from '@/components/ai/AiStatusBar';
import { AiChat } from '@/components/ai/AiChat';
import { AiApprovals } from '@/components/ai/AiApprovals';
import { AiLog } from '@/components/ai/AiLog';
import { AiSettings } from '@/components/ai/AiSettings';

/** Status poll while the page is open; the SSE stream carries everything else. */
const STATUS_POLL_MS = 5000;
/** Lines kept in the transcript; older ones are dropped from the top. */
const MAX_CHAT_LINES = 600;

type Tab = 'log' | 'settings';

export default function AiCommanderPage() {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [error, setError] = useState('');
  const [streamOpen, setStreamOpen] = useState(false);
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [tab, setTab] = useState<Tab>('log');
  const [logVersion, setLogVersion] = useState(0);
  const chatCursor = useRef(0);
  const tempId = useRef(-1);

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await ai.status());
      setError('');
    } catch (err: unknown) {
      setError(errorMessage(err));
    }
  }, []);

  const loadChat = useCallback(async () => {
    try {
      const body = await ai.chat(chatCursor.current, 200);
      if (body.items.length > 0) {
        chatCursor.current = body.last_id;
        setChat((prev) => [...prev, ...body.items].slice(-MAX_CHAT_LINES));
      }
    } catch (err: unknown) {
      setError(errorMessage(err));
    }
  }, []);

  const loadApprovals = useCallback(async () => {
    try {
      setApprovals((await ai.approvals(false)).items);
    } catch (err: unknown) {
      setError(errorMessage(err));
    }
  }, []);

  // Initial load + status polling.
  useEffect(() => {
    const initial = setTimeout(() => {
      void loadStatus();
      void loadChat();
      void loadApprovals();
    }, 0);
    const timer = setInterval(loadStatus, STATUS_POLL_MS);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [loadStatus, loadChat, loadApprovals]);

  // Live notifications. Chat lines arrive without ids, so they get temporary
  // negative keys; the next cursor fetch is the source of truth.
  useEffect(() => {
    const close = openAiStream((kind, payload) => {
      if (kind === 'chat') {
        const line: ChatLine = {
          id: tempId.current--,
          kind: String(payload.kind || 'notice'),
          author: String(payload.author || ''),
          text: String(payload.text || ''),
          wake_id: (payload.wake_id as number | null) ?? null,
          created_at: new Date().toISOString(),
        };
        setChat((prev) => [...prev, line].slice(-MAX_CHAT_LINES));
      } else if (kind === 'approval') {
        void loadApprovals();
      } else if (kind === 'tool_call' || kind === 'llm_call') {
        setLogVersion((v) => v + 1);
      } else if (kind === 'session' || kind === 'settings') {
        void loadStatus();
      }
    }, setStreamOpen);
    return close;
  }, [loadApprovals, loadStatus]);

  const sendOrder = async (text: string) => {
    await ai.sendOrder(text, 'dashboard');
    void loadStatus();
  };

  const resolve = async (id: number, decision: 'approved' | 'denied', note?: string) => {
    await ai.resolveApproval(id, decision, note, 'dashboard');
    void loadApprovals();
  };

  const toggleKill = async (on: boolean) => {
    await ai.updateSettings({ kill_switch: on });
    void loadStatus();
  };

  const tabButton = (id: Tab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      style={{
        background: tab === id ? 'var(--primary)' : 'transparent',
        color: tab === id ? 'var(--background)' : 'var(--text-dim)',
        border: '1px solid var(--panel-border)', borderRadius: '2px', padding: '4px 10px', cursor: 'pointer',
        fontSize: '11px', fontFamily: 'var(--font-mono)', textTransform: 'uppercase',
      }}
    >
      {label}
    </button>
  );

  return (
    <main className={styles.main}>
      <h1>AI Commander</h1>
      <AiStatusBar status={status} error={error} streamOpen={streamOpen} onToggleKill={toggleKill} />

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(320px, 1fr)', gap: '20px', marginTop: '20px' }}>
        <AiChat lines={chat} onSend={sendOrder} disabled={!status} />
        <AiApprovals items={approvals} onResolve={resolve} />
      </div>

      <div style={{ marginTop: '20px' }}>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
          {tabButton('log', 'Decision log')}
          {tabButton('settings', 'Settings')}
        </div>
        {tab === 'log' ? <AiLog version={logVersion} /> : <AiSettings onChanged={loadStatus} />}
      </div>
    </main>
  );
}
