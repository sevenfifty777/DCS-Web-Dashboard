import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import { errorMessage } from '@/lib/errors';

const execAsync = promisify(exec);
export const dynamic = 'force-dynamic';

interface ScheduledTask {
  TaskName: string;
  State: number;
}

function isScheduledTask(value: unknown): value is ScheduledTask {
  if (typeof value !== 'object' || value === null) return false;
  const task = value as Record<string, unknown>;
  return typeof task.TaskName === 'string' && typeof task.State === 'number';
}

export async function GET() {
  try {
    // We fetch tasks from the root folder '\' as requested
    const psCommand = `Get-ScheduledTask | Where-Object TaskPath -eq '\\' | Select-Object TaskName, State | ConvertTo-Json`;
    const { stdout } = await execAsync(`powershell -NoProfile -Command "${psCommand}"`);
    
    if (!stdout.trim()) {
      return NextResponse.json({ tasks: [] });
    }

    const parsed: unknown = JSON.parse(stdout);
    const tasks = (Array.isArray(parsed) ? parsed : [parsed]).filter(isScheduledTask);

    // Map properties and translate state from integers to strings
    const formattedTasks = tasks.map((t) => ({
      name: t.TaskName,
      state: t.State === 4 ? 'Running' : t.State === 3 ? 'Ready' : t.State === 1 ? 'Disabled' : 'Unknown',
      rawState: t.State
    }));

    // Implement whitelist filtering if DCS_TASK_WHITELIST is defined in .env.local
    const whitelistStr = process.env.DCS_TASK_WHITELIST;
    if (whitelistStr && whitelistStr.trim().length > 0) {
      const allowedTasks = whitelistStr.split(',').map(s => s.trim().toLowerCase());
      const filtered = formattedTasks.filter(t => allowedTasks.includes(t.name.toLowerCase()));
      return NextResponse.json({ tasks: filtered });
    }

    // Sort alphabetically
    formattedTasks.sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ tasks: formattedTasks });
  } catch (error: unknown) {
    console.error('Failed to get tasks:', error);
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body: unknown = await req.json();
    if (typeof body !== 'object' || body === null) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const { taskName, action } = body as Record<string, unknown>;

    if (typeof taskName !== 'string' || typeof action !== 'string') {
      return NextResponse.json({ error: 'Missing taskName or action' }, { status: 400 });
    }

    // Optional: enforce whitelist on execution as well
    const whitelistStr = process.env.DCS_TASK_WHITELIST;
    if (whitelistStr && whitelistStr.trim().length > 0) {
      const allowedTasks = whitelistStr.split(',').map(s => s.trim().toLowerCase());
      if (!allowedTasks.includes(taskName.toLowerCase())) {
        return NextResponse.json({ error: 'Task is not in the allowed whitelist.' }, { status: 403 });
      }
    }

    let psCommand = '';
    
    // Safety sanitization: Task names shouldn't contain single quotes for this to work safely.
    const safeTaskName = taskName.replace(/'/g, "''");

    if (action === 'start') {
      psCommand = `Start-ScheduledTask -TaskName '${safeTaskName}'`;
    } else if (action === 'stop') {
      psCommand = `Stop-ScheduledTask -TaskName '${safeTaskName}'`;
    } else if (action === 'restart') {
      psCommand = `Stop-ScheduledTask -TaskName '${safeTaskName}'; Start-ScheduledTask -TaskName '${safeTaskName}'`;
    } else {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    await execAsync(`powershell -NoProfile -Command "${psCommand}"`);
    
    return NextResponse.json({ success: true, message: `Task ${taskName} ${action} command sent successfully.` });
  } catch (error: unknown) {
    console.error('Failed to control scheduled task:', error);
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
