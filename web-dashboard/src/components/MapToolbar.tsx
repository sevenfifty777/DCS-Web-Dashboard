import { apiFetch } from '@/lib/api';

type ToolbarProps = {
  drawingMode: string | null;
  setDrawingMode: (mode: string | null) => void;
  myMarks: number[];
  setMyMarks: (marks: number[]) => void;
  markText: string;
  setMarkText: (text: string) => void;
  smokeColor: number;
  setSmokeColor: (color: number) => void;
};

export default function MapToolbar({ drawingMode, setDrawingMode, myMarks, setMyMarks, markText, setMarkText, smokeColor, setSmokeColor }: ToolbarProps) {
  const tools = [
    { id: 'mark', label: '📍 Mark', desc: 'Place a text marker' },
    { id: 'circle', label: '⭕ Circle', desc: 'Draw a circle (click center)' },
    { id: 'line', label: '📏 Line', desc: 'Draw a line (click start, click end)' },
    { id: 'rect', label: '⬜ Rect', desc: 'Draw a rectangle (click corner 1, corner 2)' },
    { id: 'smoke', label: '💨 Smoke', desc: 'Spawn colored smoke' },
  ];

  const clearMyMarks = async () => {
    for (const id of myMarks) {
      try {
        await apiFetch(`/api/trigger/marks/${id}`, { method: 'DELETE' });
      } catch (e) {
        console.error("Failed to delete mark", id, e);
      }
    }
    setMyMarks([]);
  };

  return (
    <div style={{
      position: 'absolute',
      top: '10px',
      left: '60px',
      zIndex: 1000,
      background: 'rgba(20, 20, 20, 0.9)',
      border: '1px solid #444',
      borderRadius: '4px',
      padding: '5px',
      display: 'flex',
      gap: '5px',
      boxShadow: '0 2px 5px rgba(0,0,0,0.5)'
    }}>
      {tools.map(t => (
        <button
          key={t.id}
          onClick={() => setDrawingMode(drawingMode === t.id ? null : t.id)}
          title={t.desc}
          style={{
            background: drawingMode === t.id ? '#0d6efd' : '#333',
            color: '#fff',
            border: 'none',
            padding: '5px 10px',
            borderRadius: '3px',
            cursor: 'pointer',
            fontWeight: drawingMode === t.id ? 'bold' : 'normal'
          }}
        >
          {t.label}
        </button>
      ))}

      <div style={{ width: '1px', background: '#555', margin: '0 5px' }} />

      {drawingMode === 'mark' && (
        <input 
          type="text" 
          value={markText} 
          onChange={(e) => setMarkText(e.target.value)} 
          placeholder="Marker Text..."
          style={{ background: '#222', color: '#fff', border: '1px solid #555', borderRadius: '3px', padding: '0 8px', fontSize: '12px', width: '120px' }}
        />
      )}

      {drawingMode === 'smoke' && (
        <select 
          value={smokeColor} 
          onChange={(e) => setSmokeColor(Number(e.target.value))}
          style={{ background: '#222', color: '#fff', border: '1px solid #555', borderRadius: '3px', padding: '0 4px', fontSize: '12px' }}
        >
          <option value={1}>Green</option>
          <option value={2}>Red</option>
          <option value={3}>White</option>
          <option value={4}>Orange</option>
          <option value={5}>Blue</option>
        </select>
      )}

      {myMarks.length > 0 && (
        <button
          onClick={clearMyMarks}
          style={{
            background: '#dc3545',
            color: '#fff',
            border: 'none',
            padding: '5px 10px',
            borderRadius: '3px',
            cursor: 'pointer',
            marginLeft: '5px'
          }}
        >
          Clear My Drawings ({myMarks.length})
        </button>
      )}
    </div>
  );
}
