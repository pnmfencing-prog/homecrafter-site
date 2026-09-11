import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { isCrmAdmin, previewText } from '@/lib/crm-admin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Ops bot ingest endpoint.
 * Auth: Authorization: Bearer <ADMIN_TOKEN> or x-admin-token: <ADMIN_TOKEN>
 * (same ADMIN_TOKEN used by CRM HTML / proxy — do not invent new secrets).
 */
export async function POST(request: NextRequest) {
  if (!isCrmAdmin(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const bodyText = String(body.body_text || body.body || '').trim();
  if (!bodyText) {
    return NextResponse.json({ error: 'body_text is required' }, { status: 400 });
  }

  let threadId = String(body.thread_id || '').trim() || null;
  let vendorId = String(body.vendor_id || '').trim() || null;
  const channel = String(body.channel || 'in_app').trim() || 'in_app';
  const title = String(body.title || 'General').trim() || 'General';
  const actorType = String(body.actor_type || 'bot').trim();
  const actorLabel = String(body.actor_label || actorType).trim() || actorType;
  const messageKind = String(body.message_kind || 'chat').trim() || 'chat';
  const direction = String(body.direction || (actorType === 'staff' ? 'outbound' : 'inbound')).trim();
  const externalMessageId = body.external_message_id ? String(body.external_message_id) : null;
  const orderPayload = body.order_payload ?? null;

  if (!['bot', 'vendor', 'staff'].includes(actorType)) {
    return NextResponse.json({ error: 'actor_type must be bot|vendor|staff' }, { status: 400 });
  }
  if (!['sms', 'email', 'in_app', 'other'].includes(channel)) {
    return NextResponse.json({ error: 'invalid channel' }, { status: 400 });
  }

  if (!threadId) {
    if (!vendorId) {
      return NextResponse.json({ error: 'vendor_id or thread_id is required' }, { status: 400 });
    }
    const vendor = await sql`SELECT id FROM crm_vendor_profiles WHERE id = ${vendorId}::uuid LIMIT 1`;
    if (!vendor.length) {
      return NextResponse.json({ error: 'Vendor not found' }, { status: 404 });
    }

    const existing = await sql`
      SELECT id FROM crm_comm_threads
      WHERE vendor_id = ${vendorId}::uuid
        AND channel = ${channel}
        AND title = ${title}
      ORDER BY updated_at DESC
      LIMIT 1
    `;

    if (existing.length) {
      threadId = existing[0].id;
    } else {
      const created = await sql`
        INSERT INTO crm_comm_threads (vendor_id, channel, title, linked_job_id, linked_order_id)
        VALUES (
          ${vendorId}::uuid,
          ${channel},
          ${title},
          ${body.linked_job_id ? String(body.linked_job_id) : null},
          ${body.linked_order_id ? String(body.linked_order_id) : null}
        )
        RETURNING id, vendor_id
      `;
      threadId = created[0].id;
      vendorId = created[0].vendor_id;
    }
  }

  const threadRows = await sql`
    SELECT id, vendor_id FROM crm_comm_threads WHERE id = ${threadId}::uuid LIMIT 1
  `;
  if (!threadRows.length) {
    return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
  }
  vendorId = threadRows[0].vendor_id;

  const preview = previewText(bodyText);
  const bumpUnread = actorType === 'bot' || actorType === 'vendor';

  const deliveryStatus = body.delivery_status
    ? String(body.delivery_status)
    : (actorType === 'staff' ? 'sent' : null);

  const messageRows = await sql`
    INSERT INTO crm_comm_messages (
      thread_id, actor_type, actor_label, body_text, message_kind,
      order_payload, direction, delivery_status, external_message_id
    ) VALUES (
      ${threadId}::uuid,
      ${actorType},
      ${actorLabel},
      ${bodyText},
      ${messageKind},
      ${orderPayload},
      ${direction},
      ${deliveryStatus},
      ${externalMessageId}
    )
    RETURNING *
  `;

  await sql`
    UPDATE crm_comm_threads
    SET
      last_message_preview = ${preview},
      last_message_at = NOW(),
      updated_at = NOW(),
      unread_count = CASE WHEN ${bumpUnread} THEN unread_count + 1 ELSE unread_count END
    WHERE id = ${threadId}::uuid
  `;

  await sql`
    UPDATE crm_vendor_profiles
    SET last_activity_at = NOW(), updated_at = NOW()
    WHERE id = ${vendorId}::uuid
  `;

  return NextResponse.json({
    success: true,
    thread_id: threadId,
    vendor_id: vendorId,
    message: messageRows[0],
  });
}
