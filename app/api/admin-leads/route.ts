import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';

interface Filters {
  category?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  zip?: string;
  proAccountId?: number;
  search?: string;
}

function parseFilters(params: URLSearchParams): Filters {
  const f: Filters = {};
  const cat = params.get('category');
  if (cat && cat !== 'all') f.category = cat;
  const st = params.get('status');
  if (st && st !== 'all') f.status = st;
  if (params.get('dateFrom')) f.dateFrom = params.get('dateFrom')!;
  if (params.get('dateTo')) f.dateTo = params.get('dateTo')!;
  if (params.get('zip')) f.zip = params.get('zip')!;
  const pro = params.get('proAccountId');
  if (pro) f.proAccountId = parseInt(pro);
  if (params.get('search')) f.search = params.get('search')!.toLowerCase();
  return f;
}

async function getFilteredLeadIds(f: Filters, withPro: boolean) {
  if (withPro) {
    return await sql`
      SELECT DISTINCT l.id FROM leads l
      JOIN lead_assignments la ON la.lead_id = l.id
      WHERE 1=1
        AND (${f.category || null}::text IS NULL OR ${f.category || null} = ANY(l.services))
        AND (${f.status || null}::text IS NULL OR l.status = ${f.status || null})
        AND (${f.dateFrom || null}::text IS NULL OR l.submitted_at >= ${f.dateFrom || '1900-01-01'}::timestamp)
        AND (${f.dateTo || null}::text IS NULL OR l.submitted_at <= ${f.dateTo || '2100-01-01'}::timestamp + interval '1 day')
        AND (${f.zip || null}::text IS NULL OR l.zip LIKE '%' || ${f.zip || ''} || '%')
        AND la.pro_account_id = ${f.proAccountId!}
        AND (${f.search || null}::text IS NULL OR (lower(coalesce(l.homeowner_name,'')) LIKE '%' || ${f.search || ''} || '%' OR lower(coalesce(l.homeowner_email,'')) LIKE '%' || ${f.search || ''} || '%' OR coalesce(l.homeowner_phone,'') LIKE '%' || ${f.search || ''} || '%'))
    `;
  }
  return await sql`
    SELECT l.id FROM leads l
    WHERE 1=1
      AND (${f.category || null}::text IS NULL OR ${f.category || null} = ANY(l.services))
      AND (${f.status || null}::text IS NULL OR l.status = ${f.status || null})
      AND (${f.dateFrom || null}::text IS NULL OR l.submitted_at >= ${f.dateFrom || '1900-01-01'}::timestamp)
      AND (${f.dateTo || null}::text IS NULL OR l.submitted_at <= ${f.dateTo || '2100-01-01'}::timestamp + interval '1 day')
      AND (${f.zip || null}::text IS NULL OR l.zip LIKE '%' || ${f.zip || ''} || '%')
      AND (${f.search || null}::text IS NULL OR (lower(coalesce(l.homeowner_name,'')) LIKE '%' || ${f.search || ''} || '%' OR lower(coalesce(l.homeowner_email,'')) LIKE '%' || ${f.search || ''} || '%' OR coalesce(l.homeowner_phone,'') LIKE '%' || ${f.search || ''} || '%'))
  `;
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const page = parseInt(params.get('page') || '1') || 1;
    const limit = Math.min(parseInt(params.get('limit') || '50') || 50, 200);
    const offset = (page - 1) * limit;
    const sortCol = params.get('sortBy') || 'submitted_at';
    const sortDir = (params.get('sortDir') || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
    const f = parseFilters(params);
    const hasFilters = Object.keys(f).length > 0;

    let leads: any[], totalCount: number;

    if (hasFilters) {
      const filteredIds = await getFilteredLeadIds(f, !!f.proAccountId);
      const ids = filteredIds.map((r: any) => r.id);
      totalCount = ids.length;

      if (ids.length === 0) {
        leads = [];
      } else {
        leads = await sql`
          SELECT l.id, l.homeowner_name, l.homeowner_email, l.homeowner_phone, l.services, l.zip, l.status, l.submitted_at,
            (SELECT pa.first_name || ' ' || pa.last_name FROM lead_assignments la JOIN pro_accounts pa ON pa.id = la.pro_account_id WHERE la.lead_id = l.id LIMIT 1) as assigned_contractor,
            (SELECT count(*)::int FROM lead_assignments la WHERE la.lead_id = l.id) as spots_sold
          FROM leads l
          WHERE l.id = ANY(${ids})
          ORDER BY
            CASE WHEN ${sortCol} = 'homeowner_name' AND ${sortDir} = 'asc' THEN l.homeowner_name END ASC,
            CASE WHEN ${sortCol} = 'homeowner_name' AND ${sortDir} = 'desc' THEN l.homeowner_name END DESC,
            CASE WHEN ${sortCol} = 'zip' AND ${sortDir} = 'asc' THEN l.zip END ASC,
            CASE WHEN ${sortCol} = 'zip' AND ${sortDir} = 'desc' THEN l.zip END DESC,
            CASE WHEN ${sortCol} = 'status' AND ${sortDir} = 'asc' THEN l.status END ASC,
            CASE WHEN ${sortCol} = 'status' AND ${sortDir} = 'desc' THEN l.status END DESC,
            CASE WHEN ${sortCol} = 'submitted_at' AND ${sortDir} = 'asc' THEN l.submitted_at END ASC,
            CASE WHEN ${sortCol} = 'submitted_at' AND ${sortDir} = 'desc' THEN l.submitted_at END DESC,
            l.submitted_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `;
      }
    } else {
      const countResult = await sql`SELECT count(*)::int as count FROM leads`;
      totalCount = countResult[0]?.count || 0;
      leads = await sql`
        SELECT l.id, l.homeowner_name, l.homeowner_email, l.homeowner_phone, l.services, l.zip, l.status, l.submitted_at,
          (SELECT pa.first_name || ' ' || pa.last_name FROM lead_assignments la JOIN pro_accounts pa ON pa.id = la.pro_account_id WHERE la.lead_id = l.id LIMIT 1) as assigned_contractor,
          (SELECT count(*)::int FROM lead_assignments la WHERE la.lead_id = l.id) as spots_sold
        FROM leads l
        ORDER BY
          CASE WHEN ${sortCol} = 'homeowner_name' AND ${sortDir} = 'asc' THEN l.homeowner_name END ASC,
          CASE WHEN ${sortCol} = 'homeowner_name' AND ${sortDir} = 'desc' THEN l.homeowner_name END DESC,
          CASE WHEN ${sortCol} = 'zip' AND ${sortDir} = 'asc' THEN l.zip END ASC,
          CASE WHEN ${sortCol} = 'zip' AND ${sortDir} = 'desc' THEN l.zip END DESC,
          CASE WHEN ${sortCol} = 'status' AND ${sortDir} = 'asc' THEN l.status END ASC,
          CASE WHEN ${sortCol} = 'status' AND ${sortDir} = 'desc' THEN l.status END DESC,
          CASE WHEN ${sortCol} = 'submitted_at' AND ${sortDir} = 'asc' THEN l.submitted_at END ASC,
          CASE WHEN ${sortCol} = 'submitted_at' AND ${sortDir} = 'desc' THEN l.submitted_at END DESC,
          l.submitted_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    }

    return NextResponse.json({
      leads,
      pagination: { page, limit, total: totalCount, totalPages: Math.ceil(totalCount / limit) }
    });
  } catch (err: any) {
    console.error('Admin leads error:', err);
    return NextResponse.json({ error: 'Failed to load leads' }, { status: 500 });
  }
}
