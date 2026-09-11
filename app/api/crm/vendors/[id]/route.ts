import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { isCrmAdmin } from '@/lib/crm-admin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  if (!isCrmAdmin(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await context.params;
  const rows = await sql`
    SELECT
      v.*,
      COALESCE(SUM(t.unread_count), 0)::int AS unread_count,
      MAX(t.last_message_at) AS last_message_at
    FROM crm_vendor_profiles v
    LEFT JOIN crm_comm_threads t ON t.vendor_id = v.id
    WHERE v.id = ${id}::uuid
    GROUP BY v.id
    LIMIT 1
  `;

  if (!rows.length) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const row: any = rows[0];
  return NextResponse.json({
    vendor: {
      ...row,
      phone: row.primary_phone,
      email: row.primary_email,
      last_activity_at: row.last_activity_at || row.last_message_at || null,
    },
  });
}
