"use client";
import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import styles from '../page.module.css';

export default function WarehousePage() {
  const [airbase, setAirbase] = useState('');
  const [inventory, setInventory] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  
  const [itemName, setItemName] = useState('');
  const [itemCount, setItemCount] = useState(1);
  const [liquidType, setLiquidType] = useState(0);
  const [liquidAmount, setLiquidAmount] = useState(100.0);

  const fetchInventory = async () => {
    if (!airbase) return;
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await apiFetch(`/api/warehouse/inventory?airbase_name=${encodeURIComponent(airbase)}`);
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Failed to fetch inventory');
      setInventory(data.inventory);
    } catch (e: any) {
      setErrorMsg(e.message);
    } finally {
      setLoading(false);
    }
  };

  const addItem = async () => {
    if (!airbase || !itemName) return;
    try {
      const res = await apiFetch('/api/warehouse/item/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ airbase_name: airbase, item_name: itemName, count: itemCount })
      });
      if (!res.ok) throw new Error('Failed to add item');
      alert(`Successfully added ${itemCount}x ${itemName} to ${airbase}`);
      fetchInventory();
    } catch (e: any) {
      alert(e.message);
    }
  };

  const addLiquid = async () => {
    if (!airbase) return;
    try {
      const res = await apiFetch('/api/warehouse/liquid/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ airbase_name: airbase, liquid_type: liquidType, amount: liquidAmount })
      });
      if (!res.ok) throw new Error('Failed to add liquid');
      alert(`Successfully added ${liquidAmount} units of liquid type ${liquidType} to ${airbase}`);
      fetchInventory();
    } catch (e: any) {
      alert(e.message);
    }
  };

  return (
    <main className={styles.main}>
      <h1>Airbase Logistics</h1>
      <p style={{ color: 'var(--text-secondary)' }}>
        View and manage warehouse inventories.
      </p>

      {errorMsg && (
        <div style={{ backgroundColor: 'rgba(255,68,68,0.1)', border: '1px solid #ff4444', color: '#ff4444', padding: '1rem', borderRadius: '4px', marginBottom: '1rem' }}>
          {errorMsg}
        </div>
      )}

      <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem' }}>
        <input 
          type="text" 
          placeholder="Airbase Name (e.g. Vaziani)" 
          value={airbase} 
          onChange={e => setAirbase(e.target.value)}
          style={{ padding: '0.5rem', flex: 1, backgroundColor: 'var(--card-bg)', border: '1px solid var(--panel-border)', color: 'var(--foreground)', borderRadius: '4px' }}
        />
        <button 
          onClick={fetchInventory} 
          disabled={loading || !airbase}
          style={{ padding: '0.5rem 1rem', backgroundColor: 'var(--primary)', color: '#000', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 }}
        >
          {loading ? 'Loading...' : 'Fetch Inventory'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
        <div style={{ flex: 2, minWidth: '350px' }}>
          <h3>Inventory for {inventory ? airbase : '...'}</h3>
          {inventory ? (
            <div style={{ backgroundColor: 'var(--card-bg)', padding: '1rem', border: '1px solid var(--panel-border)', borderRadius: '4px', maxHeight: '500px', overflowY: 'auto' }}>
              <pre style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
                {JSON.stringify(inventory, null, 2)}
              </pre>
            </div>
          ) : (
            <p style={{ color: 'var(--text-muted)' }}>Enter an airbase name and fetch to view inventory.</p>
          )}
        </div>

        <div style={{ flex: 1, minWidth: '300px', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div style={{ backgroundColor: 'var(--card-bg)', padding: '1.5rem', border: '1px solid var(--panel-border)', borderRadius: '4px' }}>
            <h4 style={{ marginTop: 0, color: 'var(--primary)', borderBottom: '1px solid var(--panel-border)', paddingBottom: '0.5rem' }}>Add Item</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <input type="text" placeholder="Item Name (e.g. AIM-120C)" value={itemName} onChange={e => setItemName(e.target.value)} style={{ padding: '0.5rem', backgroundColor: 'var(--bg-darker)', border: '1px solid var(--panel-border)', color: '#fff', borderRadius: '4px' }} />
              <input type="number" placeholder="Count" value={itemCount} onChange={e => setItemCount(parseInt(e.target.value))} style={{ padding: '0.5rem', backgroundColor: 'var(--bg-darker)', border: '1px solid var(--panel-border)', color: '#fff', borderRadius: '4px' }} />
              <button onClick={addItem} style={{ padding: '0.5rem', backgroundColor: 'var(--success)', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>Add Item</button>
            </div>
          </div>

          <div style={{ backgroundColor: 'var(--card-bg)', padding: '1.5rem', border: '1px solid var(--panel-border)', borderRadius: '4px' }}>
            <h4 style={{ marginTop: 0, color: 'var(--primary)', borderBottom: '1px solid var(--panel-border)', paddingBottom: '0.5rem' }}>Add Liquid</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <select value={liquidType} onChange={e => setLiquidType(parseInt(e.target.value))} style={{ padding: '0.5rem', backgroundColor: 'var(--bg-darker)', border: '1px solid var(--panel-border)', color: '#fff', borderRadius: '4px' }}>
                <option value={0}>Jet Fuel</option>
                <option value={1}>Avgas</option>
                <option value={2}>MW50</option>
                <option value={3}>Diesel</option>
              </select>
              <input type="number" step="0.1" placeholder="Amount (Tons)" value={liquidAmount} onChange={e => setLiquidAmount(parseFloat(e.target.value))} style={{ padding: '0.5rem', backgroundColor: 'var(--bg-darker)', border: '1px solid var(--panel-border)', color: '#fff', borderRadius: '4px' }} />
              <button onClick={addLiquid} style={{ padding: '0.5rem', backgroundColor: 'var(--success)', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>Add Liquid</button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
