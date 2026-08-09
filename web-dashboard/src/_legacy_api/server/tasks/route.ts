import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // We fetch tasks from the root folder '\' as requested
    const psCommand = `Get-ScheduledTask | Where-Object TaskPath -eq '\\' | Select-Object TaskName, State | ConvertTo-Json`;
    const { stdout } = await execAsync(`powershell -NoProfile -Command "${psCommand}"`);
    
    if (!stdout.trim()) {
      return NextResponse.json({ tasks: [] });
    }

    let parsed = JSON.parse(stdout);
    let tasks = Array.isArray(parsed) ? parsed : [parsed];

    // Map properties and translate state from integers to strings
    const formattedTasks = tasks.map((t: any) => ({
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
  } catch (error: any) {
    console.error('Failed to get tasks:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { taskName, action } = body;

    if (!taskName || !action) {
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
  } catch (error: any) {
    console.error(`Failed to ${req.body} task:`, error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
