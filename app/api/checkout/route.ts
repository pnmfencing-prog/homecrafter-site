import { NextRequest, NextResponse } from 'next/server';
import { verifyProToken } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import {
  SINGLE_PRICES, BUNDLE_DISCOUNTS, PAIRED_BUNDLES,
  VALID_CATEGORIES, VALID_BUNDLES, VALID_PACK_SIZES,
  getBasePrice, isPairedBundle,
} from '@/lib/pricing';

async function createCheckoutSession(params: Record<string, any>) {
  const sk = process.env.STRIPE_SECRET_KEY!;
  const body = new URLSearchParams();

  body.append('mode', 'payment');
  body.append('payment_method_types[0]', 'card');
  body.append('line_items[0][price_data][currency]', 'usd');
  body.append('line_items[0][price_data][unit_amount]', String(params.unitAmount));
  body.append('line_items[0][price_data][product_data][name]', params.name);
  if (params.description) {
    body.append('line_items[0][price_data][product_data][description]', params.description);
  }
  body.append('line_items[0][quantity]', '1');
  body.append('success_url', params.successUrl);
  body.append('cancel_url', params.cancelUrl);

  if (params.metadata) {
    for (const [k, v] of Object.entries(params.metadata)) {
      body.append(`metadata[${k}]`, String(v));
    }
  }

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${btoa(sk + ':')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || 'Stripe error');
  return data;
}

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

    const cat = typeof category === 'string' ? category.toLowerCase().trim() : '';
    const origin = request.headers.get('origin') || request.headers.get('referer')?.replace(/\/[^/]*$/, '') || 'https://homecrafter.ai';

    // SINGLE LEAD PURCHASE
    if (leadId && !packSize) {
      if (!VALID_CATEGORIES.includes(cat)) {
        return NextResponse.json({ error: 'Invalid category' }, { status: 400 });
      }
      const price = SINGLE_PRICES[cat];
      if (!price) return NextResponse.json({ error: 'Invalid category' }, { status: 400 });

      const session = await createCheckoutSession({
        unitAmount: price * 100,
        name: `HomeCrafter Lead — ${cat}`,
        successUrl: `${origin}/pro-dashboard.html?payment=success`,
        cancelUrl: `${origin}/leads-dashboard.html`,
        metadata: {
          pro_account_id: user.id,
          category: cat,
          pack_size: '1',
          lead_id: leadId,
          type: 'single',
        },
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

    const session = await createCheckoutSession({
      unitAmount: total,
      name: `HomeCrafter ${size}-Pack — ${bundleLabel}`,
      description: `${size} lead credits at $${perLead.toFixed(2)}/lead (${Math.round(discount * 100)}% off)`,
      successUrl: `${origin}/pro-dashboard.html?payment=success`,
      cancelUrl: `${origin}/lead-bundles.html`,
      metadata: {
        pro_account_id: user.id,
        category: cat,
        pack_size: String(size),
        type: isBundleKey ? 'paired_bundle' : 'bundle',
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (e: any) {
    console.error('Checkout error:', e);
    const msg = e?.message || 'Unknown error';
    return NextResponse.json({ error: 'Server error', debug: msg }, { status: 500 });
  }
}
