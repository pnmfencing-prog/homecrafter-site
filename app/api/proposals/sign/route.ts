import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { estimate_no, signature_data, signature_name } = body;

    if (!estimate_no || !signature_data || !signature_name) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Update proposal with signature data and set status to signed
    await sql`
      UPDATE proposals 
      SET 
        signature_data = ${signature_data},
        signature_name = ${signature_name},
        signed_at = NOW(),
        status = 'signed',
        updated_at = NOW()
      WHERE estimate_no = ${estimate_no}
    `;

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Error saving signature:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}