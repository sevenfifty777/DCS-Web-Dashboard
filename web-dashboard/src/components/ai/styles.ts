// Inline style constants shared by the AI Commander components. They follow the
// CSS-variable conventions of the other dashboard pages (see chat/page.tsx).

export const panelStyle: React.CSSProperties = {
  background: 'var(--card-bg)', border: '1px solid var(--panel-border)', borderRadius: '2px', padding: '15px', minWidth: 0,
};

export const labelStyle: React.CSSProperties = {
  fontSize: '12px', fontWeight: 700, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase',
};

export const blockLabelStyle: React.CSSProperties = { ...labelStyle, display: 'block', marginBottom: '6px' };

export const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: 'var(--background)', border: '1px solid var(--panel-border)',
  color: 'var(--foreground)', padding: '6px 8px', fontSize: '13px', outline: 'none',
};

export const selectStyle: React.CSSProperties = {
  background: 'var(--background)', border: '1px solid var(--panel-border)', color: 'var(--primary)', padding: '3px 6px',
  fontFamily: 'var(--font-mono)', fontSize: '11px', outline: 'none',
};

export const primaryButtonStyle: React.CSSProperties = {
  background: 'var(--primary)', color: 'var(--background)', border: 'none', borderRadius: '2px', padding: '7px 14px',
  cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: '12px', textTransform: 'uppercase', fontWeight: 700,
};

export const monoNoteStyle: React.CSSProperties = { fontSize: '11px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' };

export const tdStyle: React.CSSProperties = { padding: '4px 6px', borderBottom: '1px solid var(--panel-border)', fontSize: '12px' };

export function tierColor(tier: string): string {
  if (tier === 'disabled') return 'var(--danger)';
  if (tier === 'approval') return 'var(--warning)';
  return 'var(--success, #3fb950)';
}
