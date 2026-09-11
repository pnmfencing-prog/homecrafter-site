import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { isCrmAdmin, previewText } from '@/lib/crm-admin';

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
  const thread = await sql`SELECT id, vendor_id FROM crm_comm_threads WHERE id = ${id}::uuid LIMIT 1`;
  if (!thread.length) {
    return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
  }

  const messages = await sql`
    SELECT
      id,
      thread_id,
      created_at,
      actor_type,
      actor_label,
      body_text,
      message_kind,
      order_payload,
      direction,
      delivery_status,
      external_message_id
    FROM crm_comm_messages
    WHERE thread_id = ${id}::uuid
    ORDER BY created_at ASC, id ASC
  `;

  return NextResponse.json({ thread: thread[0], messages });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  if (!isCrmAdmin(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const bodyText = String(body.body_text || '').trim();
  if (!bodyText) {
    return NextResponse.json({ error: 'body_text is required' }, { status: 400 });
  }

  const actorLabel = String(body.actor_label || 'Staff').trim() || 'Staff';
  const preview = previewText(bodyText);

  const threadRows = await sql`
    SELECT id, vendor_id FROM crm_comm_threads WHERE id = ${id}::uuid LIMIT 1
  `;
  if (!threadRows.length) {
    return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
  }

  const messageRows = await sql`
    INSERT INTO crm_comm_messages (
      thread_id, actor_type, actor_label, body_text, message_kind, direction, delivery_status
    ) VALUES (
      ${id}::uuid, 'staff', ${actorLabel}, ${bodyText}, 'chat', 'outbound', 'sent'
    )
    RETURNING *
  `;

  await sql`
    UPDATE crm_comm_threads
    SET
      last_message_preview = ${preview},
      last_message_at = NOW(),
      updated_at = NOW()
    WHERE id = ${id}::uuid
  `;

  await sql`
    UPDATE crm_vendor_profiles
    SET last_activity_at = NOW(), updated_at = NOW()
    WHERE id = ${threadRows[0].vendor_id}::uuid
  `;

  return NextResponse.json({ success: true, message: messageRows[0] });
}
