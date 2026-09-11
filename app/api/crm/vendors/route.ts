import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { isCrmAdmin } from '@/lib/crm-admin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function mapVendor(row: any) {
  return {
    ...row,
    phone: row.primary_phone,
    email: row.primary_email,
    last_activity_at: row.last_activity_at || row.last_message_at || null,
  };
}

export async function GET(request: NextRequest) {
  if (!isCrmAdmin(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const type = (searchParams.get('type') || '').trim();
  const q = (searchParams.get('q') || '').trim();
  const like = q ? `%${q}%` : null;

  let rows;
  if (type && like) {
    rows = await sql`
      SELECT
        v.id, v.profile_type, v.display_name, v.company, v.primary_phone, v.primary_email,
        v.website, v.status, v.notes, v.last_activity_at, v.created_at, v.updated_at,
        COALESCE(SUM(t.unread_count), 0)::int AS unread_count,
        MAX(t.last_message_at) AS last_message_at
      FROM crm_vendor_profiles v
      LEFT JOIN crm_comm_threads t ON t.vendor_id = v.id
      WHERE v.profile_type = ${type}
        AND (
          v.display_name ILIKE ${like}
          OR COALESCE(v.company, '') ILIKE ${like}
          OR COALESCE(v.primary_phone, '') ILIKE ${like}
          OR COALESCE(v.primary_email, '') ILIKE ${like}
        )
      GROUP BY v.id
      ORDER BY COALESCE(MAX(t.last_message_at), v.last_activity_at, v.updated_at, v.created_at) DESC, v.display_name ASC
    `;
  } else if (type) {
    rows = await sql`
      SELECT
        v.id, v.profile_type, v.display_name, v.company, v.primary_phone, v.primary_email,
        v.website, v.status, v.notes, v.last_activity_at, v.created_at, v.updated_at,
        COALESCE(SUM(t.unread_count), 0)::int AS unread_count,
        MAX(t.last_message_at) AS last_message_at
      FROM crm_vendor_profiles v
      LEFT JOIN crm_comm_threads t ON t.vendor_id = v.id
      WHERE v.profile_type = ${type}
      GROUP BY v.id
      ORDER BY COALESCE(MAX(t.last_message_at), v.last_activity_at, v.updated_at, v.created_at) DESC, v.display_name ASC
    `;
  } else if (like) {
    rows = await sql`
      SELECT
        v.id, v.profile_type, v.display_name, v.company, v.primary_phone, v.primary_email,
        v.website, v.status, v.notes, v.last_activity_at, v.created_at, v.updated_at,
        COALESCE(SUM(t.unread_count), 0)::int AS unread_count,
        MAX(t.last_message_at) AS last_message_at
      FROM crm_vendor_profiles v
      LEFT JOIN crm_comm_threads t ON t.vendor_id = v.id
      WHERE (
        v.display_name ILIKE ${like}
        OR COALESCE(v.company, '') ILIKE ${like}
        OR COALESCE(v.primary_phone, '') ILIKE ${like}
        OR COALESCE(v.primary_email, '') ILIKE ${like}
      )
      GROUP BY v.id
      ORDER BY COALESCE(MAX(t.last_message_at), v.last_activity_at, v.updated_at, v.created_at) DESC, v.display_name ASC
    `;
  } else {
    rows = await sql`
      SELECT
        v.id, v.profile_type, v.display_name, v.company, v.primary_phone, v.primary_email,
        v.website, v.status, v.notes, v.last_activity_at, v.created_at, v.updated_at,
        COALESCE(SUM(t.unread_count), 0)::int AS unread_count,
        MAX(t.last_message_at) AS last_message_at
      FROM crm_vendor_profiles v
      LEFT JOIN crm_comm_threads t ON t.vendor_id = v.id
      GROUP BY v.id
      ORDER BY COALESCE(MAX(t.last_message_at), v.last_activity_at, v.updated_at, v.created_at) DESC, v.display_name ASC
    `;
  }

  return NextResponse.json({ vendors: rows.map(mapVendor) });
}
