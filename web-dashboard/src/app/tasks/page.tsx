"use client";
import { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api';
import styles from '../page.module.css';
import { errorMessage } from '@/lib/errors';

interface Task {
  name: string;
  state: 'Running' | 'Ready' | 'Disabled' | 'Unknown';
  rawState: number;
}

interface WindowsService {
  name: string;
  display_name: string;
  status: string;
}


export default function TasksManager() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [services, setServices] = useState<WindowsService[]>([]);
  const [loading, setLoading] = useState(true);
  const [servicesLoading, setServicesLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTasks = async () => {
    try {
      const res = await apiFetch('/api/server/tasks');
      if (!res.ok) throw new Error('Failed to fetch tasks');
      const data = await res.json();
      setTasks(data.tasks || []);
      
      const resSvc = await apiFetch('/api/server/services');
      if (resSvc.ok) {
        const dataSvc = await resSvc.json();
        setServices(dataSvc || []);
      }

      setError(null);
    } catch (err: unknown) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
      setServicesLoading(false);
    }
  };

  useEffect(() => {
    const initial = setTimeout(fetchTasks, 0);
    const interval = setInterval(fetchTasks, 5000); // Poll every 5s
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
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
    } catch (err: unknown) {
      alert(`Error: ${errorMessage(err)}`);
    }
  };

  const handleServiceAction = async (serviceName: string, action: 'start' | 'stop' | 'restart') => {
    const actionFr = action === 'start' ? 'démarrer' : action === 'stop' ? 'arrêter' : 'redémarrer';
    if (!window.confirm(`Êtes-vous sûr(e) de vouloir ${actionFr} le service "${serviceName}" ?`)) {
      return;
    }

    try {
      const res = await apiFetch('/api/server/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: serviceName, action })
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to execute service action');
      
      fetchTasks();
    } catch (err: unknown) {
      alert(`Error: ${errorMessage(err)}`);
    }
  };

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Task Manager</h1>
      <p className={styles.subtitle} style={{ marginBottom: '20px' }}>
        Live overview of Windows Scheduled Tasks.
      </p>

      {error && <div style={{ color: 'var(--danger)', marginBottom: '10px' }}>Error: {error}</div>}

      <div style={{ backgroundColor: 'var(--panel-bg)', borderRadius: '8px', border: '1px solid var(--panel-border)', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--panel-border)', backgroundColor: 'var(--card-bg)' }}>
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
                <tr key={idx} style={{ borderBottom: '1px solid var(--panel-border)', transition: 'background-color 0.2s' }}>
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

      <h2 className={styles.subtitle} style={{ marginTop: '40px', marginBottom: '20px', color: 'var(--text-light)', fontSize: '1.2rem' }}>
        Windows Services
      </h2>
      
      <div style={{ backgroundColor: 'var(--panel-bg)', borderRadius: '8px', border: '1px solid var(--panel-border)', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--panel-border)', backgroundColor: 'var(--card-bg)' }}>
              <th style={{ padding: '15px', fontWeight: 'bold', color: 'var(--text-dim)' }}>Service Name</th>
              <th style={{ padding: '15px', fontWeight: 'bold', color: 'var(--text-dim)' }}>Status</th>
              <th style={{ padding: '15px', fontWeight: 'bold', color: 'var(--text-dim)', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {servicesLoading && services.length === 0 ? (
              <tr><td colSpan={3} style={{ padding: '15px', textAlign: 'center' }}>Loading services...</td></tr>
            ) : services.length === 0 ? (
              <tr><td colSpan={3} style={{ padding: '15px', textAlign: 'center' }}>No configured services found (add them to WINDOWS_SERVICES in .env)</td></tr>
            ) : (
              services.map((svc, idx) => (
                <tr key={idx} style={{ borderBottom: '1px solid var(--panel-border)', transition: 'background-color 0.2s' }}>
                  <td style={{ padding: '15px' }}>
                    <div style={{ fontFamily: 'var(--font-mono)' }}>{svc.name}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-dim)', marginTop: '4px' }}>{svc.display_name}</div>
                  </td>
                  <td style={{ padding: '15px' }}>
                    <span style={{
                      display: 'inline-block',
                      padding: '4px 10px',
                      borderRadius: '12px',
                      fontSize: '12px',
                      fontWeight: 'bold',
                      backgroundColor: svc.status === 'Running' ? 'rgba(0, 255, 0, 0.1)' : svc.status === 'Stopped' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 170, 0, 0.1)',
                      color: svc.status === 'Running' ? 'var(--success)' : svc.status === 'Stopped' ? 'var(--text-dim)' : '#ffaa00',
                      border: `1px solid ${svc.status === 'Running' ? 'rgba(0, 255, 0, 0.2)' : svc.status === 'Stopped' ? 'rgba(255, 255, 255, 0.2)' : 'rgba(255, 170, 0, 0.2)'}`
                    }}>
                      {svc.status}
                    </span>
                  </td>
                  <td style={{ padding: '15px', textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                      <button 
                        onClick={() => handleServiceAction(svc.name, 'start')}
                        disabled={svc.status === 'Running' || svc.status.includes('Pending')}
                        style={{
                          background: 'rgba(0, 255, 0, 0.1)', border: '1px solid rgba(0,255,0,0.3)', color: 'var(--success)',
                          padding: '6px 12px', borderRadius: '4px', cursor: svc.status === 'Running' || svc.status.includes('Pending') ? 'not-allowed' : 'pointer',
                          opacity: svc.status === 'Running' || svc.status.includes('Pending') ? 0.3 : 1
                        }}
                      >
                        ▶ Start
                      </button>
                      <button 
                        onClick={() => handleServiceAction(svc.name, 'stop')}
                        disabled={svc.status !== 'Running'}
                        style={{
                          background: 'rgba(255, 68, 68, 0.1)', border: '1px solid rgba(255,68,68,0.3)', color: 'var(--danger)',
                          padding: '6px 12px', borderRadius: '4px', cursor: svc.status !== 'Running' ? 'not-allowed' : 'pointer',
                          opacity: svc.status !== 'Running' ? 0.3 : 1
                        }}
                      >
                        ⏹ Stop
                      </button>
                      <button 
                        onClick={() => handleServiceAction(svc.name, 'restart')}
                        disabled={svc.status !== 'Running'}
                        style={{
                          background: 'rgba(255, 170, 0, 0.1)', border: '1px solid rgba(255,170,0,0.3)', color: '#ffaa00',
                          padding: '6px 12px', borderRadius: '4px', cursor: svc.status !== 'Running' ? 'not-allowed' : 'pointer',
                          opacity: svc.status !== 'Running' ? 0.3 : 1
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
