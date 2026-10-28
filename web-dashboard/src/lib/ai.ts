// AI Commander client helpers.
//
// Everything goes through the Rust backend proxy at `/api/ai/*`, which adds the
// shared secret and enforces the dashboard session. The SSE stream cannot send
// headers, so it carries the JWT as a query parameter that the backend verifies.

import { apiFetch, getToken } from './api';

export interface AiHealth {
  grpc_ok: boolean;
  grpc_error: string;
  events_stream_ok: boolean;
  units_stream_ok: boolean;
  api_state: string;
  api_error: string;
  loop_state: string;
  last_wake_at: number | null;
  last_wake_reason: string;
}

export interface AiStatus {
  version: string;
  uptime_s: number;
  health: AiHealth;
  session: { session_id: number | null; mission_name: string; theatre: string };
  budget: { cap_usd: number; spent_today_usd: number; remaining_usd: number };
  kill_switch: boolean;
  units_tracked: number;
  model_ready: boolean;
  events_total: number;
  pending_approvals: number;
  queue_size: number;
  models: { commander: string; triage: string; effort: string };
}

export interface ChatLine {
  id: number;
  kind: 'order' | 'sitrep' | 'notice' | 'thinking' | 'progress' | 'tool' | 'approval' | 'announce' | string;
  author: string;
  text: string;
  wake_id: number | null;
  created_at: string;
}

export interface Approval {
  id: number;
  tool: string;
  args: Record<string, unknown>;
  intent: string | null;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  note: string | null;
  created_at: string;
  expires_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

export interface ToolCallRow {
  id: number;
  tool: string;
  args: Record<string, unknown>;
  tier: string;
  status: string;
  result: unknown;
  started_at: string;
  finished_at: string | null;
}

export interface LlmCallRow {
  id: number;
  purpose: string;
  model: string;
  stop_reason: string | null;
  input_tokens: number;
  cache_write: number;
  cache_read: number;
  output_tokens: number;
  cost_usd: number;
  latency_ms: number;
  error: string | null;
  created_at: string;
}

export interface ToolPolicyEntry { default: string; override: string; effective: string }

export interface AiSettings {
  kill_switch: boolean;
  mission_brief: string;
  daily_budget_usd: number;
  protected_flags: string;
  protected_groups: string[];
  tool_policy: Record<string, ToolPolicyEntry>;
  effort: string;
  review_minutes: number;
  approval_timeout_min: number;
}

async function readJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string; detail?: string }).error || (data as { detail?: string }).detail || `request failed (${res.status})`);
  return data as T;
}

export const ai = {
  status: () => apiFetch('/api/ai/status').then((r) => readJson<AiStatus>(r)),
  sendOrder: (text: string, author = 'operator') =>
    apiFetch('/api/ai/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, author }) })
      .then((r) => readJson<{ wake_id: number; queued: number }>(r)),
  chat: (since = 0, limit = 200) =>
    apiFetch(`/api/ai/chat?since=${since}&limit=${limit}`).then((r) => readJson<{ items: ChatLine[]; last_id: number }>(r)),
  approvals: (all = false) =>
    apiFetch(`/api/ai/approvals?all=${all}`).then((r) => readJson<{ items: Approval[] }>(r)),
  resolveApproval: (id: number, status: 'approved' | 'denied', note?: string, by = 'operator') =>
    apiFetch(`/api/ai/approvals/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status, note: note || null, by }) })
      .then((r) => readJson<{ ok: boolean }>(r)),
  log: (since = 0, limit = 100) =>
    apiFetch(`/api/ai/log?since=${since}&limit=${limit}`).then((r) => readJson<{ tool_calls: ToolCallRow[]; llm_calls: LlmCallRow[] }>(r)),
  settings: () => apiFetch('/api/ai/settings').then((r) => readJson<AiSettings>(r)),
  updateSettings: (patch: Partial<Pick<AiSettings, 'kill_switch' | 'mission_brief' | 'daily_budget_usd' | 'protected_flags'>> & { tool_tiers?: Record<string, string | null> }) =>
    apiFetch('/api/ai/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
      .then((r) => readJson<{ changed: string[] }>(r)),
};

/**
 * Open the notification stream. `onEvent` receives (kind, payload). Reconnects
 * automatically through the browser EventSource; the backend replays the gap
 * from `Last-Event-ID`.
 */
export function openAiStream(onEvent: (kind: string, payload: Record<string, unknown>, id: string | null) => void, onState?: (open: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const token = getToken() || '';
  const url = `/api/ai/stream?token=${encodeURIComponent(token)}`;
  const es = new EventSource(url);
  const kinds = ['chat', 'approval', 'tool_call', 'llm_call', 'event', 'session', 'settings', 'ping'];
  for (const kind of kinds) {
    es.addEventListener(kind, (ev) => {
      const me = ev as MessageEvent<string>;
      let payload: Record<string, unknown> = {};
      try { payload = JSON.parse(me.data); } catch { payload = { raw: me.data }; }
      onEvent(kind, payload, me.lastEventId || null);
    });
  }
  es.onopen = () => onState?.(true);
  es.onerror = () => onState?.(false);
  return () => es.close();
}
