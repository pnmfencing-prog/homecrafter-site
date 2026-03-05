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
    const f = parseFilters(params);
    const hasFilters = Object.keys(f).length > 0;

    let leadStats: any[], totalLeads: number, assignedLeads: number;

    if (hasFilters) {
      const filteredLeadIds = await getFilteredLeadIds(f, !!f.proAccountId);
      const ids = filteredLeadIds.map((r: any) => r.id);

      if (ids.length === 0) {
        leadStats = [];
        totalLeads = 0;
        assignedLeads = 0;
      } else {
        leadStats = await sql`SELECT status, count(*)::int as count FROM leads WHERE id = ANY(${ids}) GROUP BY status`;
        totalLeads = leadStats.reduce((s: number, r: any) => s + r.count, 0);
        const assignedResult = await sql`SELECT count(DISTINCT lead_id)::int as count FROM lead_assignments WHERE lead_id = ANY(${ids})`;
        assignedLeads = assignedResult[0]?.count || 0;
      }
    } else {
      leadStats = await sql`SELECT status, count(*)::int as count FROM leads GROUP BY status`;
      totalLeads = leadStats.reduce((s: number, r: any) => s + r.count, 0);
      const assignedResult = await sql`SELECT count(DISTINCT lead_id)::int as count FROM lead_assignments`;
      assignedLeads = assignedResult[0]?.count || 0;
    }

    const openLeads = totalLeads - assignedLeads;
    const proResult = await sql`SELECT count(*)::int as count FROM pro_accounts`;
    const activePros = proResult[0]?.count || 0;

    const revenueResult = await sql`
      SELECT count(*)::int as total_purchases, coalesce(sum(credits_total), 0)::int as total_credits_sold
      FROM lead_credits`;

    const assignmentRevenue = await sql`
      SELECT count(*)::int as paid_assignments FROM lead_assignments WHERE stripe_session_id IS NOT NULL`;

    const topContractors = await sql`
      SELECT pa.first_name || ' ' || pa.last_name as name, pa.company,
        count(lc.id)::int as bundles_purchased,
        coalesce(sum(lc.credits_total), 0)::int as total_credits,
        coalesce(sum(lc.credits_used), 0)::int as credits_used
      FROM pro_accounts pa
      LEFT JOIN lead_credits lc ON lc.pro_account_id = pa.id
      GROUP BY pa.id, pa.first_name, pa.last_name, pa.company
      ORDER BY total_credits DESC LIMIT 10`;

    const recentLeads = await sql`
      SELECT id, homeowner_name, services, zip, status, submitted_at
      FROM leads ORDER BY submitted_at DESC LIMIT 10`;

    const recentAssignments = await sql`
      SELECT la.id, la.sent_at, la.category, la.status,
        l.homeowner_name as lead_name, l.zip as lead_zip,
        pa.first_name || ' ' || pa.last_name as pro_name
      FROM lead_assignments la
      LEFT JOIN leads l ON l.id = la.lead_id
      LEFT JOIN pro_accounts pa ON pa.id = la.pro_account_id
      ORDER BY la.sent_at DESC LIMIT 10`;

    const recentPurchases = await sql`
      SELECT lc.id, lc.category, lc.bundle_type, lc.credits_total, lc.purchased_at,
        pa.first_name || ' ' || pa.last_name as pro_name
      FROM lead_credits lc
      LEFT JOIN pro_accounts pa ON pa.id = lc.pro_account_id
      ORDER BY lc.purchased_at DESC LIMIT 10`;

    const leadsByService = await sql`
      SELECT unnest(services) as service, count(*)::int as count
      FROM leads GROUP BY service ORDER BY count DESC`;

    return NextResponse.json({
      stats: {
        totalLeads, openLeads, assignedLeads, activePros,
        totalPurchases: revenueResult[0]?.total_purchases || 0,
        totalCreditsSold: revenueResult[0]?.total_credits_sold || 0,
        paidAssignments: assignmentRevenue[0]?.paid_assignments || 0,
        statusBreakdown: leadStats,
        leadsByService,
      },
      topContractors, recentLeads, recentAssignments, recentPurchases,
    });
  } catch (err: any) {
    console.error('Admin stats error:', err);
    return NextResponse.json({ error: 'Failed to load stats' }, { status: 500 });
  }
}
