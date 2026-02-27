import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { rateLimit } from '@/lib/rate-limit';
import sql from '@/lib/db';
import { getZipCoords } from '@/lib/geo';

const JWT_SECRET = process.env.JWT_SECRET || 'hc-pro-secret-change-in-production';
const RADIUS_MILES = 30;

export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!rateLimit(`match:${ip}`, 10, 60 * 1000)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

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
    ? searchParams.get('services')!.split(',').map(s => s.trim().toLowerCase())
    : [];
  const maxResults = Math.min(parseInt(searchParams.get('max') || '3') || 3, 10);

  if (!zip || !/^\d{5}$/.test(zip)) {
    return NextResponse.json({ error: 'Valid 5-digit zip required' }, { status: 400 });
  }

  const coords = getZipCoords(zip);
  if (!coords) {
    return NextResponse.json({ error: `Unknown zip code: ${zip}`, results: [] });
  }

  const baseQuery = `
    SELECT * FROM (
      SELECT name, category, rating, reviews,
        (3958.8 * 2 * ASIN(SQRT(
          POWER(SIN(RADIANS(lat - ${coords.lat}) / 2), 2) +
          COS(RADIANS(${coords.lat})) * COS(RADIANS(lat)) *
          POWER(SIN(RADIANS(lng - ${coords.lng}) / 2), 2)
        ))) AS distance
      FROM contractors
      WHERE active = true AND lat IS NOT NULL
  `;

  const rows = services.length > 0
    ? await sql`
        SELECT * FROM (
          SELECT name, category, rating, reviews,
            (3958.8 * 2 * ASIN(SQRT(
              POWER(SIN(RADIANS(lat - ${coords.lat}) / 2), 2) +
              COS(RADIANS(${coords.lat})) * COS(RADIANS(lat)) *
              POWER(SIN(RADIANS(lng - ${coords.lng}) / 2), 2)
            ))) AS distance
          FROM contractors
          WHERE category = ANY(${services})
            AND active = true AND lat IS NOT NULL
        ) sub
        WHERE distance <= ${RADIUS_MILES}
        ORDER BY distance ASC, rating DESC NULLS LAST
        LIMIT ${maxResults}
      `
    : await sql`
        SELECT * FROM (
          SELECT name, category, rating, reviews,
            (3958.8 * 2 * ASIN(SQRT(
              POWER(SIN(RADIANS(lat - ${coords.lat}) / 2), 2) +
              COS(RADIANS(${coords.lat})) * COS(RADIANS(lat)) *
              POWER(SIN(RADIANS(lng - ${coords.lng}) / 2), 2)
            ))) AS distance
          FROM contractors
          WHERE active = true AND lat IS NOT NULL
        ) sub
        WHERE distance <= ${RADIUS_MILES}
        ORDER BY distance ASC, rating DESC NULLS LAST
        LIMIT ${maxResults}
      `;

  return NextResponse.json({
    origin: { zip, ...coords },
    totalMatches: rows.length,
    results: rows.map((r: any) => ({
      name: r.name,
      category: r.category,
      distance: Math.round(parseFloat(r.distance) * 10) / 10,
      rating: r.rating,
      reviews: r.reviews,
    })),
  });
}
