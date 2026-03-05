import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const page = Math.max(1, parseInt(sp.get('page') || '1'));
    const limit = Math.min(100, Math.max(1, parseInt(sp.get('limit') || '50')));
    const offset = (page - 1) * limit;
    const category = sp.get('category') || '';
    const county = sp.get('county') || '';
    const search = sp.get('search') || '';
    const hasEmail = sp.get('hasEmail') || '';
    const hasPhone = sp.get('hasPhone') || '';
    const minRating = parseFloat(sp.get('minRating') || '0');

    // Get filtered total
    const countResult = await sql`SELECT COUNT(*)::int as total FROM contractors
      WHERE (${category} = '' OR category = ${category})
        AND (${county} = '' OR county = ${county})
        AND (${search} = '' OR name ILIKE ${'%' + search + '%'} OR email ILIKE ${'%' + search + '%'} OR phone ILIKE ${'%' + search + '%'})
        AND (${hasEmail} = '' OR (${hasEmail} = 'yes' AND email IS NOT NULL AND email != '') OR (${hasEmail} = 'no' AND (email IS NULL OR email = '')))
        AND (${hasPhone} = '' OR (${hasPhone} = 'yes' AND phone IS NOT NULL AND phone != '') OR (${hasPhone} = 'no' AND (phone IS NULL OR phone = '')))
        AND rating >= ${minRating}`;
    const total = countResult[0]?.total || 0;

    const rows = await sql`
      SELECT id, name, phone, email, address, zip, category, county, state, rating, reviews
      FROM contractors
      WHERE (${category} = '' OR category = ${category})
        AND (${county} = '' OR county = ${county})
        AND (${search} = '' OR name ILIKE ${'%' + search + '%'} OR email ILIKE ${'%' + search + '%'} OR phone ILIKE ${'%' + search + '%'})
        AND (${hasEmail} = '' OR (${hasEmail} = 'yes' AND email IS NOT NULL AND email != '') OR (${hasEmail} = 'no' AND (email IS NULL OR email = '')))
        AND (${hasPhone} = '' OR (${hasPhone} = 'yes' AND phone IS NOT NULL AND phone != '') OR (${hasPhone} = 'no' AND (phone IS NULL OR phone = '')))
        AND rating >= ${minRating}
      ORDER BY LOWER(name) ASC NULLS LAST
      LIMIT ${limit} OFFSET ${offset}`;

    const categories = await sql`SELECT DISTINCT TRIM(category) as cat FROM contractors WHERE category IS NOT NULL ORDER BY cat`;
    const counties = await sql`SELECT DISTINCT TRIM(county) as c FROM contractors WHERE county IS NOT NULL AND county != '' ORDER BY c`;

    return NextResponse.json({
      contractors: rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      filters: {
        categories: categories.map((r: any) => r.cat),
        counties: counties.map((r: any) => r.c),
      }
    });
  } catch (err: any) {
    console.error('admin-contractors error:', err);
    return NextResponse.json({ error: 'Failed to load contractors' }, { status: 500 });
  }
}
