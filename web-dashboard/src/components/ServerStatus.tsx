"use client";
import { useEffect, useState } from 'react';
import styles from './ServerStatus.module.css';

export default function ServerStatus() {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    fetch('/api/health')
      .then(r => r.json())
      .then(setData)
      .catch(console.error);
  }, []);

  if (!data) return <div className={styles.card}>Loading Server Status...</div>;

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <h2>Server Status</h2>
        <div className={`${styles.statusDot} ${data.health?.alive ? styles.online : styles.offline}`} />
      </div>
      <div className={styles.info}>
        <p><strong>Version:</strong> {data.version?.version || 'Unknown'}</p>
        <p><strong>Status:</strong> {data.health?.alive ? 'Online' : 'Offline'}</p>
      </div>
    </div>
  );
}
