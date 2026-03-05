import { NextRequest, NextResponse } from 'next/server';
import { verifyProToken } from '@/lib/auth';
import sql from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const user = verifyProToken(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const pros = await sql`SELECT id FROM pro_accounts WHERE email = ${user.email}`;
    if (!pros.length) return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    const proId = pros[0].id;

    const bundles = await sql`
      SELECT id, category, bundle_type, credits_total, credits_used, credits_remaining,
        purchase_type, purchased_at
      FROM lead_credits
      WHERE pro_account_id = ${proId}
      ORDER BY purchased_at DESC`;

    const usage = await sql`
      SELECT la.id, la.sent_at, la.category, la.status,
        l.homeowner_name, l.zip, l.services
      FROM lead_assignments la
      JOIN leads l ON l.id = la.lead_id
      WHERE la.pro_account_id = ${proId}
      ORDER BY la.sent_at DESC
      LIMIT 50`;

    return NextResponse.json({ bundles, usage });
  } catch (err: any) {
    console.error('Pro bundles error:', err);
    return NextResponse.json({ error: 'Failed to load data' }, { status: 500 });
  }
}
