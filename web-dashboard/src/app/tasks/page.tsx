"use client";
import { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api';
import styles from '../page.module.css';

interface Task {
  name: string;
  state: 'Running' | 'Ready' | 'Disabled' | 'Unknown';
  rawState: number;
}

export default function TasksManager() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTasks = async () => {
    try {
      const res = await apiFetch('/api/server/tasks');
      if (!res.ok) throw new Error('Failed to fetch tasks');
      const data = await res.json();
      setTasks(data.tasks || []);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 5000); // Poll every 5s
    return () => clearInterval(interval);
  }, []);

  const handleAction = async (taskName: string, action: 'start' | 'stop' | 'restart') => {
    // Special extremely scary guardrail for the full server restart task
    if (taskName.toLowerCase().includes('restartserver')) {
      const actionFr = action === 'start' ? 'démarrer' : action === 'stop' ? 'arrêter' : 'redémarrer';
      if (!window.confirm(`⚠️ DANGER EXTRÊME ! ⚠️\n\nDémarrer cette tâche va IMMÉDIATEMENT REDÉMARRER le serveur Windows et expulser tous les utilisateurs !\n\nÊtes-vous absolument sûr(e) à 100% de vouloir ${actionFr} la tâche "${taskName}" ?`)) {
        return;
      }
    } else {
      // Normal confirmation for all other tasks
      const actionFr = action === 'start' ? 'démarrer' : action === 'stop' ? 'arrêter' : 'redémarrer';
      if (!window.confirm(`Êtes-vous sûr(e) de vouloir ${actionFr} la tâche "${taskName}" ?`)) {
        return;
      }
    }

    try {
      const res = await apiFetch('/api/server/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskName, action })
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to execute action');
      
      // Refresh immediately
      fetchTasks();
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Task Manager</h1>
      <p className={styles.subtitle} style={{ marginBottom: '20px' }}>
        Live overview of Windows Scheduled Tasks.
      </p>

      {error && <div style={{ color: 'var(--danger)', marginBottom: '10px' }}>Error: {error}</div>}

      <div style={{ backgroundColor: 'var(--bg-secondary)', borderRadius: '8px', border: '1px solid var(--border)', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', backgroundColor: 'rgba(0,0,0,0.2)' }}>
              <th style={{ padding: '15px', fontWeight: 'bold', color: 'var(--text-dim)' }}>Task Name</th>
              <th style={{ padding: '15px', fontWeight: 'bold', color: 'var(--text-dim)' }}>Status</th>
              <th style={{ padding: '15px', fontWeight: 'bold', color: 'var(--text-dim)', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && tasks.length === 0 ? (
              <tr><td colSpan={3} style={{ padding: '15px', textAlign: 'center' }}>Loading tasks...</td></tr>
            ) : tasks.length === 0 ? (
              <tr><td colSpan={3} style={{ padding: '15px', textAlign: 'center' }}>No tasks found in the root folder.</td></tr>
            ) : (
              tasks.map((task, idx) => (
                <tr key={idx} style={{ borderBottom: '1px solid var(--border)', transition: 'background-color 0.2s' }}>
                  <td style={{ padding: '15px', fontFamily: 'var(--font-mono)' }}>{task.name}</td>
                  <td style={{ padding: '15px' }}>
                    <span style={{
                      display: 'inline-block',
                      padding: '4px 10px',
                      borderRadius: '12px',
                      fontSize: '12px',
                      fontWeight: 'bold',
                      backgroundColor: task.state === 'Running' ? 'rgba(0, 255, 0, 0.1)' : task.state === 'Ready' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 68, 68, 0.1)',
                      color: task.state === 'Running' ? 'var(--success)' : task.state === 'Ready' ? 'var(--text-dim)' : 'var(--danger)',
                      border: `1px solid ${task.state === 'Running' ? 'rgba(0, 255, 0, 0.2)' : task.state === 'Ready' ? 'rgba(255, 255, 255, 0.2)' : 'rgba(255, 68, 68, 0.2)'}`
                    }}>
                      {task.state}
                    </span>
                  </td>
                  <td style={{ padding: '15px', textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                      <button 
                        onClick={() => handleAction(task.name, 'start')}
                        disabled={task.state === 'Running' || task.state === 'Disabled'}
                        style={{
                          background: 'rgba(0, 255, 0, 0.1)', border: '1px solid rgba(0,255,0,0.3)', color: 'var(--success)',
                          padding: '6px 12px', borderRadius: '4px', cursor: task.state === 'Running' || task.state === 'Disabled' ? 'not-allowed' : 'pointer',
                          opacity: task.state === 'Running' || task.state === 'Disabled' ? 0.3 : 1
                        }}
                      >
                        ▶ Start
                      </button>
                      <button 
                        onClick={() => handleAction(task.name, 'stop')}
                        disabled={task.state !== 'Running'}
                        style={{
                          background: 'rgba(255, 68, 68, 0.1)', border: '1px solid rgba(255,68,68,0.3)', color: 'var(--danger)',
                          padding: '6px 12px', borderRadius: '4px', cursor: task.state !== 'Running' ? 'not-allowed' : 'pointer',
                          opacity: task.state !== 'Running' ? 0.3 : 1
                        }}
                      >
                        ⏹ Stop
                      </button>
                      <button 
                        onClick={() => handleAction(task.name, 'restart')}
                        disabled={task.state !== 'Running'}
                        style={{
                          background: 'rgba(255, 170, 0, 0.1)', border: '1px solid rgba(255,170,0,0.3)', color: '#ffaa00',
                          padding: '6px 12px', borderRadius: '4px', cursor: task.state !== 'Running' ? 'not-allowed' : 'pointer',
                          opacity: task.state !== 'Running' ? 0.3 : 1
                        }}
                      >
                        🔄 Restart
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
