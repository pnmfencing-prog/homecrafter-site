import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { isCrmAdmin } from '@/lib/crm-admin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  if (!isCrmAdmin(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await context.params;
  const rows = await sql`
    UPDATE crm_comm_threads
    SET unread_count = 0, updated_at = NOW()
    WHERE id = ${id}::uuid
    RETURNING id, vendor_id, unread_count, last_message_at, updated_at
  `;

  if (!rows.length) {
    return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true, thread: rows[0] });
}
