import { NextResponse } from 'next/server';

export async function GET() {
  const sk = process.env.STRIPE_SECRET_KEY || '';
  return NextResponse.json({
    hasKey: !!sk,
    prefix: sk.substring(0, 20),
    length: sk.length,
    hasStar: sk.includes('*'),
  });
}
