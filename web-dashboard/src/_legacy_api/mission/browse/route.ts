import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { errorMessage } from '@/lib/errors';

async function getFiles(dir: string, depth: number = 0, maxDepth: number = 3): Promise<string[]> {
  if (depth > maxDepth) return [];
  
  try {
    const dirents = await fs.readdir(dir, { withFileTypes: true });
    let files: string[] = [];
    
    for (const dirent of dirents) {
      const res = path.resolve(dir, dirent.name);
      if (dirent.isDirectory()) {
        // Skip hidden folders or Uploads folder
        if (dirent.name.startsWith('.') || dirent.name === 'Uploads') continue;
        
        const subFiles = await getFiles(res, depth + 1, maxDepth);
        files = files.concat(subFiles);
      } else {
        if (dirent.name.endsWith('.miz')) {
          files.push(res);
        }
      }
    }
    return files;
  } catch {
    // Ignore permission errors or unreadable directories
    return [];
  }
}

export async function GET() {
  try {
    // Resolve path to the DCS Missions folder
    const dcsDir = process.env.DCS_SAVED_GAMES_DIR || path.join(process.cwd(), '..', '..', '..');
    const missionsDir = path.resolve(dcsDir, 'Missions');
    
    let allFiles: string[] = [];
    try {
      allFiles = await getFiles(missionsDir);
    } catch {
      // ignore if folder doesn't exist
    }

    // Filter only .miz files and exclude the Uploads folder to avoid duplication
    const mizFiles = allFiles
      .filter(f => f.endsWith('.miz'))
      .filter(f => !f.includes('Missions\\Uploads') && !f.includes('Missions/Uploads'));

    return NextResponse.json({
      success: true,
      files: mizFiles
    });
  } catch (err: unknown) {
    console.error('Failed to browse missions:', err);
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
