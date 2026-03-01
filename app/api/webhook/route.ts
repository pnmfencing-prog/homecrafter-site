import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';

const STRIPE_SK = process.env.STRIPE_SECRET_KEY!;

function generateClaimCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 for clarity
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return `HC-${code}`;
}

async function fetchStripeSession(sessionId: string) {
  const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
    headers: { 'Authorization': `Basic ${btoa(STRIPE_SK + ':')}` },
  });
  if (!res.ok) throw new Error('Failed to fetch Stripe session');
  return res.json();
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const event = body;

    // We verify by fetching the session from Stripe directly
    if (event.type !== 'checkout.session.completed') {
      return NextResponse.json({ received: true });
    }

    const sessionId = event.data?.object?.id;
    if (!sessionId) {
      return NextResponse.json({ error: 'No session ID' }, { status: 400 });
    }

    // Verify session with Stripe API
    const session = await fetchStripeSession(sessionId);
    if (session.payment_status !== 'paid') {
      return NextResponse.json({ received: true, note: 'not paid' });
    }

    const meta = session.metadata || {};
    const category = meta.category;
    const packSize = parseInt(meta.pack_size) || 1;
    const type = meta.type;
    const leadId = meta.lead_id ? parseInt(meta.lead_id) : null;
    const proAccountId = meta.pro_account_id ? parseInt(meta.pro_account_id) : null;
    const isGuest = meta.guest === 'true';
    const buyerEmail = session.customer_details?.email || session.customer_email || '';

    if (!category) {
      console.error('Webhook: missing category in metadata', meta);
      return NextResponse.json({ error: 'Missing metadata' }, { status: 400 });
    }

    // BUNDLE purchase (pack_size > 1)
    if (packSize > 1) {
      if (!proAccountId) {
        console.error('Webhook: bundle purchase without pro_account_id');
        return NextResponse.json({ error: 'Bundle requires account' }, { status: 400 });
      }

      // Prevent duplicate
      const existing = await sql`SELECT id FROM lead_credits WHERE stripe_session_id = ${sessionId}`;
      if (existing.length > 0) {
        return NextResponse.json({ received: true, note: 'already processed' });
      }

      const bundleType = type === 'paired_bundle' ? category : null;
      await sql`
        INSERT INTO lead_credits (pro_account_id, category, bundle_type, credits_remaining, stripe_session_id)
        VALUES (${proAccountId}, ${category}, ${bundleType}, ${packSize}, ${sessionId})
      `;
      console.log(`Bundle credits added: pro=${proAccountId}, cat=${category}, credits=${packSize}`);
    }

    // SINGLE LEAD purchase
    if (leadId && packSize === 1) {
      // Prevent duplicate
      const existing = await sql`SELECT id FROM lead_assignments WHERE stripe_session_id = ${sessionId}`;
      if (existing.length > 0) {
        return NextResponse.json({ received: true, note: 'already processed' });
      }

      const claimCode = isGuest || !proAccountId ? generateClaimCode() : null;

      await sql`
        INSERT INTO lead_assignments (lead_id, pro_account_id, category, stripe_email, claim_code, stripe_session_id)
        VALUES (${leadId}, ${proAccountId}, ${category}, ${buyerEmail}, ${claimCode}, ${sessionId})
      `;
      console.log(`Lead assigned: lead=${leadId}, pro=${proAccountId || 'guest'}, email=${buyerEmail}, code=${claimCode}`);
    }

    return NextResponse.json({ received: true });
  } catch (e: any) {
    console.error('Webhook error:', e);
    return NextResponse.json({ error: 'Webhook processing error' }, { status: 500 });
  }
}
