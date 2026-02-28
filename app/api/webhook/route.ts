import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import sql from '@/lib/db';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-02-25.clover' });
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

export async function POST(request: NextRequest) {
  let event: Stripe.Event;

  try {
    const body = await request.text();
    const sig = request.headers.get('stripe-signature');
    if (!sig) return NextResponse.json({ error: 'Missing signature' }, { status: 400 });

    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Webhook signature verification failed:', message);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const meta = session.metadata || {};

    const proAccountId = parseInt(meta.pro_account_id);
    const category = meta.category;
    const packSize = parseInt(meta.pack_size) || 1;
    const type = meta.type; // 'single', 'bundle', 'paired_bundle'
    const sessionId = session.id;

    if (!proAccountId || !category) {
      console.error('Webhook: missing metadata', meta);
      return NextResponse.json({ error: 'Missing metadata' }, { status: 400 });
    }

    // Prevent duplicate processing
    const existing = await sql`
      SELECT id FROM lead_credits WHERE stripe_session_id = ${sessionId}
    `;
    if (existing.length > 0) {
      return NextResponse.json({ received: true, note: 'already processed' });
    }

    // For single lead purchase, create 1 credit
    // For bundles, create credits_remaining = pack_size
    // For paired bundles, store the bundle key (e.g. 'exterior') so credits work for any category in bundle
    const bundleType = type === 'paired_bundle' ? category : null;

    await sql`
      INSERT INTO lead_credits (pro_account_id, category, bundle_type, credits_remaining, stripe_session_id)
      VALUES (${proAccountId}, ${category}, ${bundleType}, ${packSize}, ${sessionId})
    `;

    console.log(`Credits added: pro=${proAccountId}, cat=${category}, bundle=${bundleType}, credits=${packSize}`);
  }

  return NextResponse.json({ received: true });
}
