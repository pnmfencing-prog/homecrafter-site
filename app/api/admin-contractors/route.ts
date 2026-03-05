import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const page = Math.max(1, parseInt(sp.get('page') || '1'));
    const limit = Math.min(100, Math.max(1, parseInt(sp.get('limit') || '50')));
    const offset = (page - 1) * limit;
    const sortBy = sp.get('sortBy') || 'name';
    const sortDir = sp.get('sortDir') === 'desc' ? 'DESC' : 'ASC';
    const category = sp.get('category') || '';
    const county = sp.get('county') || '';
    const minRating = sp.get('minRating') || '';
    const hasEmail = sp.get('hasEmail') || '';
    const hasPhone = sp.get('hasPhone') || '';
    const search = sp.get('search') || '';

    // Allowed sort columns
    const sortCols: Record<string, string> = {
      name: 'name', phone: 'phone', email: 'email', category: 'category',
      county: 'county', rating: 'rating', reviews: 'reviews'
    };
    const sortCol = sortCols[sortBy] || 'name';

    const conditions: string[] = [];
    const params: (string | number)[] = [];
    let pi = 0;

    if (category) { pi++; conditions.push(`category = $${pi}`); params.push(category); }
    if (county) { pi++; conditions.push(`county = $${pi}`); params.push(county); }
    if (minRating) { pi++; conditions.push(`rating >= $${pi}`); params.push(parseFloat(minRating)); }
    if (hasEmail === 'yes') conditions.push(`email IS NOT NULL AND email != ''`);
    if (hasEmail === 'no') conditions.push(`(email IS NULL OR email = '')`);
    if (hasPhone === 'yes') conditions.push(`phone IS NOT NULL AND phone != ''`);
    if (hasPhone === 'no') conditions.push(`(phone IS NULL OR phone = '')`);
    if (search) {
      pi++;
      const like = `$${pi}`;
      conditions.push(`(name ILIKE ${like} OR phone ILIKE ${like} OR email ILIKE ${like} OR address ILIKE ${like})`);
      params.push(`%${search}%`);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    // Count
    const countQ = `SELECT COUNT(*) as total FROM contractors ${where}`;
    const countRes = await sql(countQ, params);
    const total = parseInt(countRes[0].total as string);

    // Null handling for sort
    const nullSort = (sortDir === 'ASC') ? 'NULLS LAST' : 'NULLS FIRST';

    // Data
    const dataQ = `SELECT id, name, phone, email, address, zip, category, county, state, rating, reviews
      FROM contractors ${where}
      ORDER BY ${sortCol} ${sortDir} ${nullSort}
      LIMIT ${limit} OFFSET ${offset}`;
    const rows = await sql(dataQ, params);

    // Also get filter options
    const categories = await sql(`SELECT DISTINCT TRIM(category) as cat FROM contractors WHERE category IS NOT NULL ORDER BY cat`);
    const counties = await sql(`SELECT DISTINCT TRIM(county) as c FROM contractors WHERE county IS NOT NULL AND county != '' ORDER BY c`);

    return NextResponse.json({
      contractors: rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      filters: {
        categories: categories.map((r: Record<string, unknown>) => r.cat),
        counties: counties.map((r: Record<string, unknown>) => r.c),
      }
    });
  } catch (err) {
    console.error('admin-contractors error:', err);
    return NextResponse.json({ error: 'Failed to load contractors' }, { status: 500 });
  }
}
