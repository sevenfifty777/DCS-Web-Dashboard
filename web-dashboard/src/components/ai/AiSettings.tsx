"use client";
import { useCallback, useEffect, useState } from 'react';
import { ai, type AiSettings as AiSettingsShape } from '@/lib/ai';
import { errorMessage } from '@/lib/errors';
import { blockLabelStyle, inputStyle, monoNoteStyle, panelStyle, primaryButtonStyle, selectStyle, tdStyle, tierColor } from './styles';

const TIERS = ['auto', 'approval', 'disabled'] as const;
const BRIEF_HINT = 'Map, scenario, sides, scripted frameworks in use, protected groups (never touch), framework-owned flags, late-activation templates available for clone_group, standing instructions.';

export function AiSettings({ onChanged }: { onChanged: () => void }) {
  const [settings, setSettings] = useState<AiSettingsShape | null>(null);
  const [brief, setBrief] = useState('');
  const [budget, setBudget] = useState('10');
  const [flags, setFlags] = useState('');
  const [tiers, setTiers] = useState<Record<string, string>>({});
  const [status, setStatus] = useState('');

  const load = useCallback(async () => {
    try {
      const s = await ai.settings();
      setSettings(s);
      setBrief(s.mission_brief);
      setBudget(String(s.daily_budget_usd));
      setFlags(s.protected_flags);
      setTiers(Object.fromEntries(Object.entries(s.tool_policy).map(([name, p]) => [name, p.override || ''])));
      setStatus('');
    } catch (err: unknown) {
      setStatus(`Error: ${errorMessage(err)}`);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(t);
  }, [load]);

  const save = async () => {
    if (!settings) return;
    setStatus('Saving...');
    try {
      const tool_tiers: Record<string, string | null> = {};
      for (const [name, override] of Object.entries(tiers)) {
        if ((settings.tool_policy[name]?.override || '') !== override) tool_tiers[name] = override || null;
      }
      const patch: Parameters<typeof ai.updateSettings>[0] = {};
      if (brief !== settings.mission_brief) patch.mission_brief = brief;
      const cap = Number(budget);
      if (!Number.isNaN(cap) && cap !== settings.daily_budget_usd) patch.daily_budget_usd = cap;
      if (flags !== settings.protected_flags) patch.protected_flags = flags;
      if (Object.keys(tool_tiers).length) patch.tool_tiers = tool_tiers;
      const res = await ai.updateSettings(patch);
      setStatus(res.changed.length ? `Saved: ${res.changed.join(', ')}` : 'Nothing changed');
      await load();
      onChanged();
    } catch (err: unknown) {
      setStatus(`Error: ${errorMessage(err)}`);
    }
  };

  if (!settings) {
    return <div style={panelStyle}><p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>{status || 'Loading settings...'}</p></div>;
  }

  const toolNames = Object.keys(settings.tool_policy).sort();
  const meta = `${settings.effort} effort · review every ${settings.review_minutes} min · approvals expire after ${settings.approval_timeout_min} min`
    + (settings.protected_groups.length ? ` · protected groups: ${settings.protected_groups.join(', ')}` : '');

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '20px' }}>
      <div style={panelStyle}>
        <span style={blockLabelStyle}>Mission brief (read by the commander on every wake)</span>
        <textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={14} maxLength={20000} placeholder={BRIEF_HINT}
          style={{ ...inputStyle, fontFamily: 'var(--font-mono)', fontSize: '12px', resize: 'vertical' }} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '12px' }}>
          <div>
            <span style={blockLabelStyle}>Daily budget (USD)</span>
            <input value={budget} onChange={(e) => setBudget(e.target.value)} inputMode="decimal" style={inputStyle} />
          </div>
          <div>
            <span style={blockLabelStyle}>Framework-owned flags</span>
            <input value={flags} onChange={(e) => setFlags(e.target.value)} placeholder="e.g. 100-199, 250" style={inputStyle} />
          </div>
        </div>
        <p style={{ ...monoNoteStyle, margin: '10px 0 0' }}>{meta}</p>
      </div>
      <div style={panelStyle}>
        <span style={blockLabelStyle}>Tool tiers (override the default; blank = default)</span>
        <div style={{ maxHeight: '420px', overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {toolNames.map((name) => {
                const p = settings.tool_policy[name];
                return (
                  <tr key={name}>
                    <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', color: 'var(--foreground)' }}>{name}</td>
                    <td style={{ ...tdStyle, ...monoNoteStyle }}>default {p.default}</td>
                    <td style={tdStyle}>
                      <select value={tiers[name] || ''} onChange={(e) => setTiers((prev) => ({ ...prev, [name]: e.target.value }))} style={selectStyle}>
                        <option value="">(default)</option>
                        {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </td>
                    <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', color: tierColor(p.effective) }}>{p.effective}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginTop: '12px' }}>
          <button type="button" onClick={save} style={primaryButtonStyle}>Save settings</button>
          {status && <span style={{ fontSize: '12px', color: status.startsWith('Error') ? 'var(--warning)' : 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{status}</span>}
        </div>
      </div>
    </div>
  );
}
