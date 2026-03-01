import { NextRequest, NextResponse } from 'next/server';
import { verifyProToken } from '@/lib/auth';
import sql from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const user = verifyProToken(request);
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { code } = await request.json();
    if (!code || typeof code !== 'string') {
      return NextResponse.json({ error: 'Missing claim code' }, { status: 400 });
    }

    const normalized = code.trim().toUpperCase();

    // Find unclaimed assignment with this code
    const assignments = await sql`
      SELECT la.*, l.homeowner_name, l.homeowner_email, l.homeowner_phone, l.address, l.zip, l.services, l.notes
      FROM lead_assignments la
      JOIN leads l ON l.id = la.lead_id
      WHERE la.claim_code = ${normalized} AND la.pro_account_id IS NULL
      LIMIT 1
    `;

    if (assignments.length === 0) {
      return NextResponse.json({ error: 'Invalid or already claimed code' }, { status: 404 });
    }

    const a = assignments[0];

    // Link to user
    await sql`UPDATE lead_assignments SET pro_account_id = ${user.id} WHERE id = ${a.id}`;

    return NextResponse.json({
      success: true,
      lead: {
        name: a.homeowner_name,
        email: a.homeowner_email,
        phone: a.homeowner_phone,
        address: a.address,
        zip: a.zip,
        services: a.services,
        notes: a.notes,
      },
    });
  } catch (e: any) {
    console.error('Claim code error:', e);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
