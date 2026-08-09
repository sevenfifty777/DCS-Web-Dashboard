import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

export async function GET() {
  try {
    const dcsDir = process.env.DCS_SAVED_GAMES_DIR || path.join(process.cwd(), '..', '..', '..');
    const configPath = path.join(dcsDir, 'Config', 'serverSettings.lua');
    const content = await fs.readFile(configPath, 'utf8');

    const result: any = {
      advanced: {},
      missionList: []
    };

    // Extract advanced block
    const advMatch = content.match(/\["advanced"\]\s*=\s*\{([\s\S]*?)\},\s*--\s*end of \["advanced"\]/);
    if (advMatch) {
      const advLines = advMatch[1].split('\n');
      for (const line of advLines) {
        const m = line.match(/\["(.*?)"\]\s*=\s*(.*?),/);
        if (m) {
          const val = m[2].trim();
          result.advanced[m[1]] = val === 'true' ? true : (val === 'false' ? false : Number(val));
        }
      }
    }

    // Extract missionList
    const mlMatch = content.match(/\["missionList"\]\s*=\s*\{([\s\S]*?)\},+.*--\s*end of \["missionList"\]/);
    if (mlMatch) {
      const mlRegex = /\[\d+\]\s*=\s*"(.*?)",?/g;
      let m;
      while ((m = mlRegex.exec(mlMatch[1])) !== null) {
        result.missionList.push(m[1].replace(/\\\\/g, '\\'));
      }
    }

    // Extract primitive keys
    // Strip advanced and missionList out to avoid regex confusion
    let strippedContent = content
      .replace(/\["advanced"\]\s*=\s*\{[\s\S]*?\},\s*--\s*end of \["advanced"\]/, '')
      .replace(/\["missionList"\]\s*=\s*\{[\s\S]*?\},+.*--\s*end of \["missionList"\]/, '')
      .replace(/}\s*--\s*end of cfg.*/, '');

    // Match ["key"] = ...
    // To safely extract strings, numbers, and booleans without truncating,
    // we match ["key"] = <value>,
    // where <value> is either:
    // 1. A string: "(.*?)" (handling multiline and escaped quotes, but not strictly needed if we just match to the last quote before a comma)
    // 2. A boolean/number: [a-z0-9.]+
    
    // Split by top level keys:
    const keysRegex = /\["(.*?)"\]\s*=\s*/g;
    let match;
    let lastKey = null;
    let lastIndex = 0;
    
    while ((match = keysRegex.exec(strippedContent)) !== null) {
      if (lastKey) {
        // Extract value between previous key match end and current key match start
        let valStr = strippedContent.substring(lastIndex, match.index).trim();
        if (valStr.endsWith(',')) valStr = valStr.slice(0, -1).trim();
        
        parseAndSet(lastKey, valStr, result);
      }
      lastKey = match[1];
      lastIndex = keysRegex.lastIndex;
    }
    
    // Process the final key
    if (lastKey) {
      let valStr = strippedContent.substring(lastIndex).trim();
      // Remove trailing comma or closing bracket
      if (valStr.endsWith(',')) valStr = valStr.slice(0, -1).trim();
      parseAndSet(lastKey, valStr, result);
    }

    return NextResponse.json(result);
  } catch (err: any) {
    console.error('Failed to parse serverSettings.lua', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

function parseAndSet(key: string, val: string, result: any) {
  if (val === 'true') {
    result[key] = true;
  } else if (val === 'false') {
    result[key] = false;
  } else if (!isNaN(Number(val)) && val !== '') {
    result[key] = Number(val);
  } else if (val.startsWith('"') && val.endsWith('"')) {
    // String value - strip surrounding quotes and unescape
    result[key] = val.substring(1, val.length - 1)
      .replace(/\\"/g, '"')
      .replace(/\\\r?\n/g, '\n') // Handle DCS line continuations
      .replace(/\\n/g, '\n'); // Handle explicit \n if any
  } else {
    result[key] = val;
  }
}

export async function POST(req: Request) {
  try {
    const payload = await req.json();
    const dcsDir = process.env.DCS_SAVED_GAMES_DIR || path.join(process.cwd(), '..', '..', '..');
    const configPath = path.join(dcsDir, 'Config', 'serverSettings.lua');

    // To serialize safely, we rebuild the file from scratch instead of doing regex replace, 
    // to ensure no formatting issues corrupt the Lua table. We use CRLF (\r\n) for Windows compatibility.
    let luaStr = 'cfg = \r\n{\r\n';

    // Top-level string/number/bools
    for (const [k, v] of Object.entries(payload)) {
      if (k === 'advanced' || k === 'missionList') continue;
      
      let val = v;
      // Force known types in case the React state sent a string instead of a number
      if (['name', 'description', 'password', 'bind_address'].includes(k)) {
        val = String(v);
      } else if (['port', 'mode', 'listStartIndex', 'maxPlayers'].includes(k)) {
        val = Number(v);
      } else if (['require_pure_textures', 'require_pure_scripts', 'require_pure_clients', 'require_pure_models', 'listShuffle', 'listLoop', 'isPublic'].includes(k)) {
        val = (v === 'true' || v === true);
      }

      if (typeof val === 'string') {
        // Properly escape backslashes, quotes, and newlines for a Lua double-quoted string
        // DCS uses line-continuations: a backslash followed by a physical newline
        const escaped = val.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\\r\n');
        luaStr += `\t["${k}"] = "${escaped}",\r\n`;
      } else {
        // Boolean or Number
        luaStr += `\t["${k}"] = ${val},\r\n`;
      }
    }

    // Advanced block
    if (payload.advanced) {
      luaStr += '\t["advanced"] = \r\n\t{\r\n';
      for (const [k, v] of Object.entries(payload.advanced)) {
        let advVal = v;
        if (typeof v === 'string') {
          if (v === 'true') advVal = true;
          else if (v === 'false') advVal = false;
          else if (!isNaN(Number(v)) && v !== '') advVal = Number(v);
        }
        luaStr += `\t\t["${k}"] = ${advVal},\r\n`;
      }
      luaStr += '\t}, -- end of ["advanced"]\r\n';
    }

    // MissionList block
    if (payload.missionList && Array.isArray(payload.missionList)) {
      luaStr += '\t["missionList"] = \r\n\t{\r\n';
      payload.missionList.forEach((m: string, i: number) => {
        const escaped = m.replace(/\\/g, '\\\\');
        luaStr += `\t\t[${i + 1}] = "${escaped}",\r\n`;
      });
      luaStr += '\t}, -- end of ["missionList"]\r\n';
    }

    luaStr += '} -- end of cfg\r\n';

    await fs.writeFile(configPath, luaStr, 'utf8');

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Failed to save serverSettings.lua', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
