import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { rateLimit } from '@/lib/rate-limit';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { matchContractors } = require('../../../lib/matcher');

const JWT_SECRET = process.env.JWT_SECRET || 'hc-pro-secret-change-in-production';

export async function GET(req: NextRequest) {
  // Rate limit: 10 requests per IP per minute (even for auth'd users)
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!rateLimit(`match:${ip}`, 10, 60 * 1000)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  // Require auth — only logged-in contractors can query matches
  const authHeader = req.headers.get('authorization');
  const token = authHeader?.replace('Bearer ', '');
  if (!token) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  try {
    jwt.verify(token, JWT_SECRET);
  } catch {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const zip = searchParams.get('zip');
  const services = searchParams.get('services')
    ? searchParams.get('services')!.split(',').map(s => s.trim())
    : [];
  const maxResults = Math.min(parseInt(searchParams.get('max') || '3') || 3, 10); // Cap at 10

  if (!zip || !/^\d{5}$/.test(zip)) {
    return NextResponse.json({ error: 'Valid 5-digit zip required' }, { status: 400 });
  }

  const result = matchContractors(zip, services, maxResults);
  
  // Strip sensitive fields — only return what contractors need to see
  if (result.results) {
    result.results = result.results.map((r: any) => ({
      name: r.name,
      category: r.category,
      distance: r.distance,
      rating: r.rating,
      reviews: r.reviews,
    }));
  }

  return NextResponse.json(result);
}
