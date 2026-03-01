import { NextResponse } from 'next/server';

export async function GET() {
  const sk = process.env.STRIPE_SECRET_KEY || '';
  return NextResponse.json({
    hasStripeKey: !!sk,
    keyPrefix: sk.substring(0, 12) || 'NOT SET',
    keyLength: sk.length,
  });
}
