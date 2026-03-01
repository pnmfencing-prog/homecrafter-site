import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';

const STRIPE_SK = process.env.STRIPE_SECRET_KEY!;

export async function GET(request: NextRequest) {
  try {
    const sessionId = request.nextUrl.searchParams.get('session_id');
    if (!sessionId) {
      return NextResponse.json({ error: 'Missing session_id' }, { status: 400 });
    }

    // Verify with Stripe
    const stripeRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
      headers: { 'Authorization': `Basic ${btoa(STRIPE_SK + ':')}` },
    });
    if (!stripeRes.ok) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 400 });
    }
    const session = await stripeRes.json();
    if (session.payment_status !== 'paid') {
      return NextResponse.json({ error: 'Payment not completed' }, { status: 400 });
    }

    // Look up assignment
    const assignments = await sql`
      SELECT la.*, l.homeowner_name, l.homeowner_email, l.homeowner_phone, l.address, l.zip, l.services, l.notes
      FROM lead_assignments la
      JOIN leads l ON l.id = la.lead_id
      WHERE la.stripe_session_id = ${sessionId}
      LIMIT 1
    `;

    if (assignments.length === 0) {
      // Might be a bundle purchase or webhook hasn't fired yet
      const meta = session.metadata || {};
      if (parseInt(meta.pack_size) > 1) {
        return NextResponse.json({ type: 'bundle', packSize: meta.pack_size, category: meta.category });
      }
      return NextResponse.json({ pending: true, message: 'Processing your purchase...' });
    }

    const a = assignments[0];
    const isGuest = !a.pro_account_id;

    // Check if account exists for the stripe_email
    let accountExists = false;
    if (a.stripe_email) {
      const accts = await sql`SELECT id FROM pro_accounts WHERE email = ${a.stripe_email.toLowerCase()} LIMIT 1`;
      accountExists = accts.length > 0;
    }

    return NextResponse.json({
      type: 'single',
      lead: {
        name: a.homeowner_name,
        email: a.homeowner_email,
        phone: a.homeowner_phone,
        address: a.address,
        zip: a.zip,
        services: a.services,
        notes: a.notes,
      },
      claimCode: isGuest ? a.claim_code : null,
      stripeEmail: a.stripe_email,
      isGuest,
      accountExists,
      proAccountId: a.pro_account_id,
    });
  } catch (e: any) {
    console.error('Purchase status error:', e);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
