import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (!file.name.endsWith('.miz')) {
      return NextResponse.json({ error: 'Only .miz files are allowed' }, { status: 400 });
    }

    // Resolve path to the DCS Missions folder (relative to the web-dashboard CWD)
    // process.cwd() = C:\Users\admin\Saved Games\DCS.openbeta_server\Scripts\Web Dashboard\web-dashboard
    const dcsDir = process.env.DCS_SAVED_GAMES_DIR || path.join(process.cwd(), '..', '..', '..');
    const uploadDir = path.join(dcsDir, 'Missions', 'Uploads');
    
    // Ensure the directory exists
    await fs.mkdir(uploadDir, { recursive: true });

    const filePath = path.join(uploadDir, file.name);
    
    // Convert File to ArrayBuffer and write to disk
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    await fs.writeFile(filePath, buffer);

    return NextResponse.json({ 
      success: true, 
      message: 'File uploaded successfully',
      file_name: filePath
    });
  } catch (err: any) {
    console.error('File upload failed:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
