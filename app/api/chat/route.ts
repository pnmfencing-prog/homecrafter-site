import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { normalizeText, normalizeTrimmedText } from '@/lib/text';

// GET — fetch messages for a chat token (customer-facing)
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  if (!token || token.length < 10) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 400 });
  }

  const leads = await sql`
    SELECT id, customer_name, service_type, is_read FROM crm_leads WHERE chat_token = ${token}
  `;
  if (leads.length === 0) {
    return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
  }
  const lead = leads[0];
  const staffMode = request.nextUrl.searchParams.get('staff') === '1';
  const markRead = request.nextUrl.searchParams.get('markRead') === '1';
  if (staffMode && markRead && isAdmin(request) && lead.is_read === false) {
    await sql`UPDATE crm_leads SET is_read = true WHERE id = ${lead.id}`;
    lead.is_read = true;
  }

  const messages = await sql`
    SELECT id, activity_type, description, is_from_customer, created_at
    FROM crm_activity
    WHERE crm_lead_id = ${lead.id} AND activity_type IN ('sms', 'email')
    ORDER BY created_at ASC
  `;

  const activityIds = messages.map((m: any) => m.id);
  const attachments = activityIds.length
    ? await sql`
        SELECT id, crm_activity_id, file_name, mime_type, size_bytes, direction, created_at
        FROM crm_attachments
        WHERE crm_activity_id = ANY(${activityIds})
        ORDER BY id ASC
      `
    : [];
  const attachmentsByActivity = new Map<number, any[]>();
  for (const att of attachments) {
    const list = attachmentsByActivity.get(att.crm_activity_id) || [];
    list.push(att);
    attachmentsByActivity.set(att.crm_activity_id, list);
  }

  return NextResponse.json({
    lead: { id: lead.id, name: lead.customer_name, service: lead.service_type, isRead: lead.is_read },
    messages: messages.map((m: any) => {
      const description = normalizeText(m.description || '');
      const hasOutboundPrefix = description.startsWith('📤');
      const hasInboundPrefix = description.startsWith('📥');
      return {
        id: m.id,
        text: description.replace(/^(📤|📥)\s*/, '').replace(/^Scheduled SMS sent:\s*/i, ''),
        // Prefix is the source of truth when present. This keeps staff replies
        // dark/right even if an older row was accidentally flagged inbound.
        fromCustomer: hasInboundPrefix ? true : hasOutboundPrefix ? false : m.is_from_customer,
        time: m.created_at,
        attachments: attachmentsByActivity.get(m.id) || [],
      };
    }),
  });
}

function isAdmin(request: NextRequest): boolean {
  const auth = request.headers.get('authorization') || '';
  const token = auth.replace('Bearer ', '');
  return token === (process.env.ADMIN_TOKEN || 'hc-admin-2026');
}

// POST — customer or staff sends a message
export async function POST(request: NextRequest) {
  const body = await request.json();
  const token = body.token;
  const text = normalizeTrimmedText(body.message || '');
  const fromStaff = body.fromStaff === true;
  const channel = fromStaff && body.channel === 'email' ? 'email' : 'sms';
  const subject = String(body.subject || 'Following up from PNM Fencing').trim();

  if (!token || !text || text.length > 2000) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  if (fromStaff && !isAdmin(request)) {
    return NextResponse.json({ error: 'Unauthorized staff message' }, { status: 401 });
  }

  const leads = await sql`
    SELECT id, customer_name, customer_email FROM crm_leads WHERE chat_token = ${token}
  `;
  if (leads.length === 0) {
    return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
  }

  const leadId = leads[0].id;
  if (channel === 'email' && !leads[0].customer_email) {
    return NextResponse.json({ error: 'Customer email missing' }, { status: 400 });
  }

  const desc = fromStaff && channel === 'email'
    ? `📤 Subject: ${subject}\n\n${text}`
    : (fromStaff ? '📤 ' : '📥 ') + text;

  await sql`
    INSERT INTO crm_activity (crm_lead_id, activity_type, description, is_from_customer, created_by)
    VALUES (${leadId}, ${channel}, ${desc}, ${!fromStaff}, ${fromStaff ? 'staff_chat' : 'customer_chat'})
  `;

  if (fromStaff && channel === 'email' && process.env.BREVO_API_KEY) {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: { name: 'PNM Fencing', email: 'trent@homecrafter.ai' },
        to: [{ email: leads[0].customer_email, name: leads[0].customer_name || undefined }],
        subject,
        textContent: text,
        htmlContent: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;white-space:pre-wrap">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`,
      }),
    });
    if (!res.ok) return NextResponse.json({ error: `Email send failed: ${await res.text()}` }, { status: 502 });
  }

  await sql`
    UPDATE crm_leads
    SET updated_at = NOW(), last_message_by = ${fromStaff ? 'you' : 'customer'}, last_message_at = NOW(), is_read = ${fromStaff}
    WHERE id = ${leadId}
  `;

  return NextResponse.json({ success: true });
}
