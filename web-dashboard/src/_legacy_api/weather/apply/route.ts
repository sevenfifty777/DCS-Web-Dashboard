import { NextResponse } from 'next/server';
import { execFile } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs/promises';
import { loadMission, getMissionName } from '@/lib/grpc';
import { errorMessage } from '@/lib/errors';

const execFilePromise = util.promisify(execFile);

export async function POST(req: Request) {
  try {
    const { preset_id } = await req.json();

    if (!preset_id) {
      return NextResponse.json({ error: 'preset_id is required' }, { status: 400 });
    }

    const weatherDir = process.env.DCS_DYNAMIC_WEATHER_DIR;
    const pythonExe = process.env.PYTHON_EXE || 'python';

    if (!weatherDir) {
      return NextResponse.json({ error: 'DCS_DYNAMIC_WEATHER_DIR is not configured in environment' }, { status: 500 });
    }

    // Determine the current mission file
    let currentMission = '';

    // 1. Ask DCS directly for the currently running mission
    try {
      const activeMission = await getMissionName();
      const activeName = activeMission?.name; // e.g. "Foothold_CA_..._B"
      
      if (activeName) {
        // We need the absolute path. Read serverSettings.lua to find the directory.
        // serverSettings.lua might only list the _A.miz version, so we search by base name.
        const baseName = activeName.replace(/_[AB]$/, '');
        const dcsDir = process.env.DCS_SAVED_GAMES_DIR || path.join(process.cwd(), '..', '..', '..');
        const configPath = path.join(dcsDir, 'Config', 'serverSettings.lua');
        const content = await fs.readFile(configPath, 'utf8');
        const mlMatch = content.match(/\["missionList"\]\s*=\s*\{([\s\S]*?)\},+.*--\s*end of \["missionList"\]/);
        if (mlMatch) {
          const mlRegex = /\[\d+\]\s*=\s*"(.*?)",?/g;
          let m;
          while ((m = mlRegex.exec(mlMatch[1])) !== null) {
            const rawPath = m[1].replace(/\\\\/g, '\\');
            if (rawPath.includes(baseName)) {
              // Reconstruct the exact absolute path of the currently running mission
              const dir = path.dirname(rawPath);
              currentMission = path.join(dir, activeName + '.miz');
              break;
            }
          }
        }
      }
    } catch {
      console.warn("Could not reach DCS for active mission, falling back to dto.json");
    }

    // 2. Fallback to dto.json if DCS is offline
    if (!currentMission) {
      const dtoPath = path.join(weatherDir, 'data', 'dto.json');
      try {
        const dContent = await fs.readFile(dtoPath, 'utf8');
        const dtoData = JSON.parse(dContent);
        if (dtoData && dtoData.mission) {
          currentMission = dtoData.mission;
        }
      } catch {
        console.warn("Failed to read dto.json for current mission");
      }
    }

    // 3. Absolute Fallback to serverSettings.lua directly if everything else fails
    if (!currentMission) {
      const dcsDir = process.env.DCS_SAVED_GAMES_DIR || path.join(process.cwd(), '..', '..', '..');
      const configPath = path.join(dcsDir, 'Config', 'serverSettings.lua');
      try {
        const content = await fs.readFile(configPath, 'utf8');
        const mlMatch = content.match(/\["missionList"\]\s*=\s*\{([\s\S]*?)\},+.*--\s*end of \["missionList"\]/);
        if (mlMatch) {
          const mlRegex = /\[\d+\]\s*=\s*"(.*?)",?/g;
          const m = mlRegex.exec(mlMatch[1]);
          if (m) currentMission = m[1].replace(/\\\\/g, '\\');
        }
      } catch (e) {
        console.error('Failed to read serverSettings.lua for missionList', e);
      }
    }

    // Determine target mission for A/B swap
    let targetMission = currentMission;
    if (currentMission.endsWith('_A.miz')) {
      targetMission = currentMission.replace('_A.miz', '_B.miz');
    } else if (currentMission.endsWith('_B.miz')) {
      targetMission = currentMission.replace('_B.miz', '_A.miz');
    } else {
      console.warn("Mission does not end with _A.miz or _B.miz, weather application might fail due to file locking");
    }

    // Python script path
    const scriptPath = path.join(weatherDir, 'weather_generator.py');

    // Build the arguments array (safer than raw string in Windows cmd.exe)
    const args = [
      scriptPath,
      weatherDir,
      `--preset=${preset_id}`
    ];
    if (targetMission) {
      args.push(`--mission=${targetMission}`);
    }
    
    console.log(`Executing weather generator: ${pythonExe} ${args.join(' ')}`);

    const { stdout, stderr } = await execFilePromise(pythonExe, args, { cwd: weatherDir, timeout: 60000 });
    console.log('Weather generator stdout:', stdout);
    if (stderr) {
      console.warn('Weather generator stderr:', stderr);
    }

    // If a mission was modified, reload it in DCS
    if (targetMission) {
      const escapedPath = targetMission.replace(/\\/g, '\\\\');
      await loadMission(escapedPath);
    } else {
      console.warn("No mission found in queue to reload.");
    }

    return NextResponse.json({ success: true, output: stdout });

  } catch (err: unknown) {
    console.error('Failed to apply weather preset:', err);
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
