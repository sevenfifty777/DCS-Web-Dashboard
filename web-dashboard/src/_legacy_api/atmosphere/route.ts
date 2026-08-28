import { NextResponse } from 'next/server';
import { getWind, getTemperatureAndPressure } from '@/lib/grpc';
import { errorMessage } from '@/lib/errors';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const lat = parseFloat(searchParams.get('lat') || '');
    const lon = parseFloat(searchParams.get('lon') || '');
    const alt = parseFloat(searchParams.get('alt') || '0');

    if (isNaN(lat) || isNaN(lon) || isNaN(alt)) {
      return NextResponse.json({ error: 'Valid lat, lon, and alt are required' }, { status: 400 });
    }

    // Call both gRPC endpoints simultaneously
    const [windRes, tempRes] = await Promise.all([
      getWind(lat, lon, alt),
      getTemperatureAndPressure(lat, lon, alt)
    ]);

    return NextResponse.json({
      wind: {
        heading: windRes.heading,
        strength: windRes.strength
      },
      atmosphere: {
        temperature: tempRes.temperature,
        pressure: tempRes.pressure
      }
    });
  } catch (err: unknown) {
    console.error('Failed to get atmosphere data:', err);
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
