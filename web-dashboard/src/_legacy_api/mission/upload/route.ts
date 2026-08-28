import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { errorMessage } from '@/lib/errors';

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const safeFileName = path.basename(file.name);
    if (safeFileName !== file.name || !safeFileName.toLowerCase().endsWith('.miz')) {
      return NextResponse.json({ error: 'Only .miz files are allowed' }, { status: 400 });
    }

    // Resolve path to the DCS Missions folder (relative to the web-dashboard CWD)
    // process.cwd() = C:\Users\admin\Saved Games\DCS.openbeta_server\Scripts\Web Dashboard\web-dashboard
    const dcsDir = process.env.DCS_SAVED_GAMES_DIR || path.join(process.cwd(), '..', '..', '..');
    const uploadDir = path.join(dcsDir, 'Missions', 'Uploads');
    
    // Ensure the directory exists
    await fs.mkdir(uploadDir, { recursive: true });

    const filePath = path.join(uploadDir, safeFileName);
    
    // Convert File to ArrayBuffer and write to disk
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    await fs.writeFile(filePath, buffer);

    return NextResponse.json({ 
      success: true, 
      message: 'File uploaded successfully',
      file_name: filePath
    });
  } catch (err: unknown) {
    console.error('File upload failed:', err);
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
