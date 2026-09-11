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
  const vendor = await sql`SELECT id FROM crm_vendor_profiles WHERE id = ${id}::uuid LIMIT 1`;
  if (!vendor.length) {
    return NextResponse.json({ error: 'Vendor not found' }, { status: 404 });
  }

  const threads = await sql`
    SELECT
      id,
      vendor_id,
      channel,
      title,
      linked_job_id,
      linked_order_id,
      last_message_preview,
      last_message_at,
      unread_count,
      created_at,
      updated_at
    FROM crm_comm_threads
    WHERE vendor_id = ${id}::uuid
    ORDER BY COALESCE(last_message_at, updated_at, created_at) DESC
  `;

  return NextResponse.json({ threads });
}
