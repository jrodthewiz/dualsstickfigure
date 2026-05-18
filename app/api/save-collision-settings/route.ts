import { NextRequest, NextResponse } from 'next/server';
import { writeFile } from 'fs/promises';
import path from 'path';

// Force dynamic rendering for this route
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const data = await request.json();
    
    // Validate the data structure
    if (!data.player || !data.enemy) {
      return NextResponse.json(
        { error: 'Invalid collision settings format' },
        { status: 400 }
      );
    }

    // Write to the public directory
    const filePath = path.join(process.cwd(), 'public', 'collision-settings.json');
    await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');

    return NextResponse.json({ 
      success: true, 
      message: 'Collision settings saved successfully!' 
    });
  } catch (error) {
    console.error('Error saving collision settings:', error);
    return NextResponse.json(
      { error: 'Failed to save collision settings' },
      { status: 500 }
    );
  }
}

