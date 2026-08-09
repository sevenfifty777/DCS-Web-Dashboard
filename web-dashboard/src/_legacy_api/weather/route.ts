import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { getMissionName } from '@/lib/grpc';

export async function GET() {
  try {
    // Note: The path to the weather system must be set in .env.local
    const weatherDir = process.env.DCS_DYNAMIC_WEATHER_DIR;
    if (!weatherDir) {
      return NextResponse.json({ not_configured: true });
    }

    // Read weather_presets.json
    const presetsPath = path.join(weatherDir, 'weather_presets.json');
    let presetsData = null;
    try {
      const pContent = await fs.readFile(presetsPath, 'utf8');
      presetsData = JSON.parse(pContent);
    } catch (e) {
      console.error("Failed to read weather_presets.json from", presetsPath, e);
    }

    // Read dto.json for current applied state
    const dtoPath = path.join(weatherDir, 'data', 'dto.json');
    let dtoData = null;
    try {
      const dContent = await fs.readFile(dtoPath, 'utf8');
      dtoData = JSON.parse(dContent);
    } catch (e) {
      console.warn("Failed to read dto.json (may not exist yet) from", dtoPath);
    }

    // Attempt to query DCS directly to get the absolute source of truth
    try {
      const activeMission: any = await getMissionName();
      if (activeMission && activeMission.name && dtoData) {
        // We know what DCS is currently playing. Update the reported mission name to match reality.
        const baseName = activeMission.name.replace(/_[AB]$/, '');
        // Just construct a generic label, or if it already has the same base, replace the suffix
        if (dtoData.mission && dtoData.mission.includes(baseName)) {
          const dir = path.dirname(dtoData.mission);
          dtoData.mission = path.join(dir, activeMission.name + '.miz');
        } else {
          dtoData.mission = `(Active in DCS) ${activeMission.name}.miz`;
        }
      }
    } catch (e) {
      // Ignore if DCS is offline, just use dto.json
    }

    return NextResponse.json({
      presets: presetsData?.presets || {},
      selection_rules: presetsData?.selection_rules || {},
      dcs_cloud_presets: presetsData?.dcs_cloud_presets || {},
      current_state: dtoData || {}
    });

  } catch (err: any) {
    console.error('Failed to get weather data:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
