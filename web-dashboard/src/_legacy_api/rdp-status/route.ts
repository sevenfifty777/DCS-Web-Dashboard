import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Execute the Windows 'query user' command
    // If no users are found, it throws an error but outputs 'No User exists for *'
    const result = await execAsync('quser').catch((e: any) => e);
    
    const output = (result.stdout || result.stderr || '').toString();
    
    if (output.includes('No User exists')) {
      return NextResponse.json({ active: false, users: [] });
    }

    const lines = output.split('\n').map((line: string) => line.trim()).filter((line: string) => line.length > 0);
    
    // Remove the header line
    lines.shift();

    const users: { username: string, state: string, isRdp: boolean }[] = [];
    
    for (const line of lines) {
      const parts = line.split(/\s+/);
      if (parts.length < 3) continue;

      // The first part is always the username. Sometimes it has a '>' prefix.
      let username = parts[0];
      if (username.startsWith('>')) {
        username = username.substring(1);
      }
      
      // Determine if it's an RDP session
      const isRdp = line.toLowerCase().includes('rdp-tcp');
      
      // Find the state (handle both English 'Active' and French 'Actif')
      const isActive = line.toLowerCase().includes('active') || line.toLowerCase().includes('actif');
      const state = isActive ? 'Active' : 'Disconnected';
      
      // We only care about active RDP sessions, or perhaps we just return all active ones.
      users.push({ username, state, isRdp });
    }

    // Check if there's any active RDP session
    // Some server setups might not have 'rdp-tcp' explicitly listed if they are just labeled 'console' but the user wants to know if ANYONE is active.
    // We will consider it active if there is any active session that isn't the service itself.
    // Let's filter for just Active sessions that look like real users.
    const activeUsers = users.filter(u => u.state === 'Active');
    
    return NextResponse.json({ 
      active: activeUsers.length > 0, 
      users: activeUsers 
    });

  } catch (err: any) {
    console.error('Failed to get RDP status:', err);
    // If the command fails for a different reason, return false gracefully
    return NextResponse.json({ active: false, users: [] });
  }
}
