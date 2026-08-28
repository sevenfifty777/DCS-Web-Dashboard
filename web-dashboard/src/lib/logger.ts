import fs from 'fs/promises';
import path from 'path';
import { errorCode } from './errors';

export interface AuditLog {
  timestamp: string;
  username: string;
  userId: string;
  status: 'SUCCESS' | 'REJECTED';
  reason?: string;
}

const LOG_FILE = path.join(process.cwd(), 'audit_logs.json');
const MAX_LOGS = 1000;

export async function logAuthEvent(event: Omit<AuditLog, 'timestamp'>) {
  try {
    let logs: AuditLog[] = [];
    
    // Read existing logs if file exists
    try {
      const data = await fs.readFile(LOG_FILE, 'utf8');
      logs = JSON.parse(data);
    } catch (err: unknown) {
      if (errorCode(err) !== 'ENOENT') {
        console.error('Failed to read audit logs:', err);
      }
    }

    // Append new log at the beginning (newest first)
    const newLog: AuditLog = {
      ...event,
      timestamp: new Date().toISOString()
    };
    
    logs.unshift(newLog);

    // Enforce max logs limit
    if (logs.length > MAX_LOGS) {
      logs = logs.slice(0, MAX_LOGS);
    }

    // Write back to file
    await fs.writeFile(LOG_FILE, JSON.stringify(logs, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to write audit log:', err);
  }
}

export async function getAuthLogs(): Promise<AuditLog[]> {
  try {
    const data = await fs.readFile(LOG_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err: unknown) {
    if (errorCode(err) === 'ENOENT') return [];
    throw err;
  }
}
