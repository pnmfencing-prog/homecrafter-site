import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { verifyProToken } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import {
  SINGLE_PRICES, BUNDLE_DISCOUNTS, PAIRED_BUNDLES,
  VALID_CATEGORIES, VALID_BUNDLES, VALID_PACK_SIZES,
  getBasePrice, isPairedBundle,
} from '@/lib/pricing';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-02-25.clover' });

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    if (!rateLimit(`checkout:${ip}`, 10, 60_000)) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    }

    const user = verifyProToken(request);
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json();
    const { category, packSize, leadId } = body;

    // Validate inputs
    const cat = typeof category === 'string' ? category.toLowerCase().trim() : '';
    
    const origin = request.headers.get('origin') || request.headers.get('referer')?.replace(/\/[^/]*$/, '') || '';

    // SINGLE LEAD PURCHASE
    if (leadId && !packSize) {
      if (!VALID_CATEGORIES.includes(cat)) {
        return NextResponse.json({ error: 'Invalid category' }, { status: 400 });
      }
      const price = SINGLE_PRICES[cat];
      if (!price) return NextResponse.json({ error: 'Invalid category' }, { status: 400 });

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'payment',
        line_items: [{
          price_data: {
            currency: 'usd',
            unit_amount: price * 100,
            product_data: { name: `HomeCrafter Lead — ${cat}` },
          },
          quantity: 1,
        }],
        metadata: {
          pro_account_id: String(user.id),
          category: cat,
          pack_size: '1',
          lead_id: String(leadId),
          type: 'single',
        },
        success_url: `${origin}/pro-dashboard.html?payment=success`,
        cancel_url: `${origin}/leads-dashboard.html`,
      });

      return NextResponse.json({ url: session.url });
    }

    // BUNDLE PURCHASE
    const size = Number(packSize);
    if (!VALID_PACK_SIZES.includes(size)) {
      return NextResponse.json({ error: 'Invalid pack size (10, 25, or 50)' }, { status: 400 });
    }

    const isBundleKey = VALID_BUNDLES.includes(cat);
    const isSingleCat = VALID_CATEGORIES.includes(cat);
    if (!isBundleKey && !isSingleCat) {
      return NextResponse.json({ error: 'Invalid category or bundle' }, { status: 400 });
    }

    const basePrice = getBasePrice(cat);
    if (!basePrice) return NextResponse.json({ error: 'Invalid category' }, { status: 400 });

    const discount = BUNDLE_DISCOUNTS[size];
    const perLead = Math.round(basePrice * (1 - discount) * 100) / 100;
    const total = Math.round(perLead * size * 100); // in cents

    const bundleLabel = isPairedBundle(cat)
      ? PAIRED_BUNDLES[cat].categories.join(' / ')
      : cat;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          unit_amount: total,
          product_data: {
            name: `HomeCrafter ${size}-Pack — ${bundleLabel}`,
            description: `${size} lead credits at $${perLead.toFixed(2)}/lead (${Math.round(discount * 100)}% off)`,
          },
        },
        quantity: 1,
      }],
      metadata: {
        pro_account_id: String(user.id),
        category: cat,
        pack_size: String(size),
        type: isBundleKey ? 'paired_bundle' : 'bundle',
      },
      success_url: `${origin}/pro-dashboard.html?payment=success`,
      cancel_url: `${origin}/lead-bundles.html`,
    });

    return NextResponse.json({ url: session.url });
  } catch (e: any) {
    console.error('Checkout error:', e);
    const msg = e?.message || 'Unknown error';
    return NextResponse.json({ error: 'Server error', debug: msg }, { status: 500 });
  }
}
