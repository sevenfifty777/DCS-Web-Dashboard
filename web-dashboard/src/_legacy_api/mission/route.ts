import { NextResponse } from 'next/server';
import { getMissionName, getPaused, setPaused, stopMission, reloadCurrentMission, loadMission, hookEval } from '@/lib/grpc';

import fs from 'fs/promises';
import path from 'path';

let cachedIp = '';

async function getServerSettings() {
  try {
    const dcsDir = process.env.DCS_SAVED_GAMES_DIR || path.join(process.cwd(), '..', '..', '..');
    const configPath = path.join(dcsDir, 'Config', 'serverSettings.lua');
    const content = await fs.readFile(configPath, 'utf8');
    
    if (!cachedIp) {
      try {
        const ipRes = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(2000) });
        const ipData = await ipRes.json();
        cachedIp = ipData.ip;
      } catch (e) {
        cachedIp = 'Unknown IP';
      }
    }

    const nameMatch = content.match(/\["name"\]\s*=\s*"(.*?)"/);
    const portMatch = content.match(/\["port"\]\s*=\s*(\d+)/);
    const maxPlayersMatch = content.match(/\["maxPlayers"\]\s*=\s*["']?(\d+)["']?/);
    const passwordMatch = content.match(/\["password"\]\s*=\s*"(.*?)"/);

    const serverInfo = {
      name: nameMatch ? nameMatch[1] : 'Unknown Server',
      port: portMatch ? parseInt(portMatch[1]) : 10308,
      maxPlayers: maxPlayersMatch ? parseInt(maxPlayersMatch[1]) : 0,
      password: passwordMatch ? passwordMatch[1] : '',
      ip: cachedIp
    };

    const missionListBlockMatch = content.match(/\["missionList"\]\s*=\s*\{([\s\S]*?)\}/);
    let serverQueue: string[] = [];
    if (missionListBlockMatch) {
      const block = missionListBlockMatch[1];
      const missionRegex = /\[\d+\]\s*=\s*"(.*?)"/g;
      let match;
      while ((match = missionRegex.exec(block)) !== null) {
        serverQueue.push(match[1].replace(/\\\\/g, '\\'));
      }
    }

    return { serverInfo, serverQueue };
  } catch (err) {
    console.error("Could not parse serverSettings.lua", err);
    return { serverInfo: null, serverQueue: [] as string[] };
  }
}

export async function GET() {
  try {
    const [nameRes, pausedRes, settings]: any = await Promise.all([
      getMissionName().catch(() => ({ name: 'Unknown' })),
      getPaused().catch(() => ({ paused: false })),
      getServerSettings()
    ]);

    let uploadedMissions: string[] = [];
    try {
      const dcsDir = process.env.DCS_SAVED_GAMES_DIR || path.join(process.cwd(), '..', '..', '..');
      const uploadDir = path.join(dcsDir, 'Missions', 'Uploads');
      const files = await fs.readdir(uploadDir);
      uploadedMissions = files
        .filter(f => f.endsWith('.miz'))
        .map(f => path.join(uploadDir, f));
    } catch(e) {
      // directory might not exist yet
    }

    return NextResponse.json({
      currentMission: nameRes.name,
      isPaused: pausedRes.paused,
      serverInfo: settings.serverInfo,
      queue: settings.serverQueue,
      uploadedMissions: uploadedMissions
    });
  } catch (err: any) {
    console.error('Failed to get mission status:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

async function mutateMissionQueue(action: 'add' | 'remove', filePathOrIdx: string | number) {
  const dcsDir = process.env.DCS_SAVED_GAMES_DIR || path.join(process.cwd(), '..', '..', '..');
  const configPath = path.join(dcsDir, 'Config', 'serverSettings.lua');
  let content = await fs.readFile(configPath, 'utf8');

  const { serverQueue } = await getServerSettings();
  
  if (action === 'add') {
    if (serverQueue.includes(filePathOrIdx as string)) return; // already in queue
    serverQueue.push(filePathOrIdx as string);
  } else if (action === 'remove') {
    const idx = typeof filePathOrIdx === 'string' ? serverQueue.indexOf(filePathOrIdx) : (filePathOrIdx as number);
    if (idx > -1 && idx < serverQueue.length) {
      serverQueue.splice(idx, 1);
    }
  }

  // Rebuild the missionList lua string with CRLF
  let newMissionListStr = '\t["missionList"] = \r\n\t{\r\n';
  serverQueue.forEach((mission, i) => {
    // Lua needs double backslashes
    const escaped = mission.replace(/\\/g, '\\\\');
    newMissionListStr += `\t\t[${i + 1}] = "${escaped}",\r\n`;
  });
  newMissionListStr += '\t}';

  // Replace the old missionList block in the file string
  // We match the optional trailing comma },? so we can replace it precisely with exactly one comma
  content = content.replace(/\["missionList"\]\s*=\s*\{[\s\S]*?\},?/, newMissionListStr + ',');

  await fs.writeFile(configPath, content, 'utf8');
}

export async function POST(req: Request) {
  try {
    const { action, payload } = await req.json();

    switch (action) {
      case 'pause':
        await setPaused(true);
        break;
      case 'resume':
        await setPaused(false);
        break;
      case 'stop':
        await stopMission();
        break;
      case 'reload':
        await reloadCurrentMission();
        break;
      case 'load_file':
        if (!payload?.file_name) throw new Error('file_name is required');
        // Double-escape backslashes because DCS-gRPC might be interpreting them literally
        const escapedPath = payload.file_name.replace(/\\/g, '\\\\');
        await loadMission(escapedPath);
        break;
      case 'add_to_queue':
        if (!payload?.file_name) throw new Error('file_name is required');
        await mutateMissionQueue('add', payload.file_name);
        break;
      case 'remove_from_queue':
        if (!payload?.file_name) throw new Error('file_name is required');
        await mutateMissionQueue('remove', payload.file_name);
        break;
      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    return NextResponse.json({ success: true, action });
  } catch (err: any) {
    console.error('Failed to execute mission action:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
