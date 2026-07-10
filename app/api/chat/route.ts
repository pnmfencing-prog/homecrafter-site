import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import {
  FENCECRAFTERS_THREAD_DEFAULT_SUBJECT,
  FENCECRAFTERS_THREAD_REPLY_TO_EMAIL,
  FENCECRAFTERS_THREAD_SENDER_EMAIL,
  FENCECRAFTERS_THREAD_SENDER_NAME,
  PNM_FENCING_EMAIL_SENDING_PAUSED,
  pnmFencingEmailPausedResponse,
} from '@/lib/email-policy';
import { normalizeText, normalizeTrimmedText } from '@/lib/text';
import { assertSmsCapable, normalizeSmsPhone } from '@/lib/sms-guard';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const TWILIO_SID = process.env.TWILIO_SID || process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_TOKEN = process.env.TWILIO_TOKEN || process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_FROM = process.env.TWILIO_FROM || process.env.TWILIO_PHONE_NUMBER || '';

async function sendTwilioSms(to: string, body: string): Promise<string | null> {
  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM) {
    throw new Error('Twilio environment variables are not configured');
  }
  const cleanTo = await assertSmsCapable(to);
  const params = new URLSearchParams();
  params.append('From', TWILIO_FROM);
  params.append('To', cleanTo);
  params.append('Body', body);

  const auth = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64');
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const responseText = await res.text();
  let payload: Record<string, unknown> = {};
  try { payload = JSON.parse(responseText); } catch {}
  if (!res.ok || payload.error_code || payload.code) {
    throw new Error(`Twilio SMS failed: ${responseText}`);
  }
  return typeof payload.sid === 'string' ? payload.sid : null;
}

// GET — fetch messages for a chat token (customer-facing)
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  if (!token || token.length < 10) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 400 });
  }

  const leads = await sql`
    SELECT id, customer_name, service_type, is_read, flagged FROM crm_leads WHERE chat_token = ${token}
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
    lead: { id: lead.id, name: lead.customer_name, service: lead.service_type, isRead: lead.is_read, flagged: lead.flagged === true },
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
  const subject = String(body.subject || FENCECRAFTERS_THREAD_DEFAULT_SUBJECT).trim();
  const attachments = Array.isArray(body.attachments) ? body.attachments : [];
  const scheduledForRaw = fromStaff ? String(body.scheduledFor || '').trim() : '';

  if (!token || !text || text.length > 2000) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  if (fromStaff && !isAdmin(request)) {
    return NextResponse.json({ error: 'Unauthorized staff message' }, { status: 401 });
  }

  const leads = await sql`
    SELECT id, customer_name, customer_phone, customer_email, campaign_id, outreach_paused FROM crm_leads WHERE chat_token = ${token}
  `;
  if (leads.length === 0) {
    return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
  }

  const leadId = leads[0].id;
  if (channel === 'email' && !leads[0].customer_email) {
    return NextResponse.json({ error: 'Customer email missing' }, { status: 400 });
  }
  if (fromStaff && channel === 'email' && PNM_FENCING_EMAIL_SENDING_PAUSED) {
    return NextResponse.json(pnmFencingEmailPausedResponse(), { status: 423 });
  }

  if (scheduledForRaw) {
    if (channel !== 'sms') {
      return NextResponse.json({ error: 'Scheduled send is currently available for text messages only' }, { status: 400 });
    }
    if (attachments.length) {
      return NextResponse.json({ error: 'Scheduled text messages cannot include attachments yet' }, { status: 400 });
    }
    if (!leads[0].customer_phone) {
      return NextResponse.json({ error: 'Customer phone missing' }, { status: 400 });
    }
    const scheduledAt = new Date(scheduledForRaw);
    if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now() + 30_000) {
      return NextResponse.json({ error: 'Choose a future date/time' }, { status: 400 });
    }
    const cleanTo = normalizeSmsPhone(leads[0].customer_phone);
    const queued = await sql`
      INSERT INTO scheduled_sms (to_phone, message, scheduled_for, crm_lead_id)
      VALUES (${cleanTo}, ${text}, ${scheduledAt.toISOString()}, ${leadId})
      RETURNING id, scheduled_for
    `;
    await sql`
      INSERT INTO crm_activity (crm_lead_id, activity_type, description, is_from_customer, created_by)
      VALUES (${leadId}, 'note', ${`🕒 Scheduled SMS #${queued[0].id} for ${scheduledAt.toLocaleString('en-US', { timeZone: 'America/New_York' })}: ${text}`}, false, 'staff_chat')
    `;
    await sql`UPDATE crm_leads SET updated_at = NOW(), is_read = true WHERE id = ${leadId}`;
    return NextResponse.json({ success: true, scheduled: true, id: queued[0].id });
  }

  const desc = fromStaff && channel === 'email'
    ? `📤 Subject: ${subject}\n\n${text}`
    : (fromStaff ? '📤 ' : '📥 ') + text;

  if (fromStaff && channel === 'sms') {
    if (!leads[0].customer_phone) return NextResponse.json({ error: 'Customer phone missing' }, { status: 400 });
    if (attachments.length) return NextResponse.json({ error: 'Text attachments are saved to CRM, but MMS sending is not enabled yet. Send photos by email for now.' }, { status: 400 });
    try {
      await sendTwilioSms(leads[0].customer_phone, text);
    } catch (err: unknown) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'SMS send failed' }, { status: 502 });
    }
  }

  const inserted = await sql`
    INSERT INTO crm_activity (crm_lead_id, activity_type, description, is_from_customer, created_by)
    VALUES (${leadId}, ${channel}, ${desc}, ${!fromStaff}, ${fromStaff ? 'staff_chat' : 'customer_chat'})
    RETURNING id
  `;
  const activityId = inserted[0].id;
  for (const att of attachments.slice(0, 5)) {
    const fileName = String(att.name || 'attachment').slice(0, 180);
    const mimeType = String(att.mimeType || 'application/octet-stream').slice(0, 120);
    const dataBase64 = String(att.dataBase64 || '').replace(/^data:[^;]+;base64,/, '');
    if (!dataBase64) continue;
    const sizeBytes = Math.floor((dataBase64.length * 3) / 4);
    await sql`
      INSERT INTO crm_attachments (crm_activity_id, crm_lead_id, file_name, mime_type, content_base64, size_bytes, direction)
      VALUES (${activityId}, ${leadId}, ${fileName}, ${mimeType}, ${dataBase64}, ${sizeBytes}, ${fromStaff ? 'outbound' : 'inbound'})
    `;
  }

  if (fromStaff && channel === 'email' && process.env.BREVO_API_KEY) {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: { name: FENCECRAFTERS_THREAD_SENDER_NAME, email: FENCECRAFTERS_THREAD_SENDER_EMAIL },
        replyTo: { name: FENCECRAFTERS_THREAD_SENDER_NAME, email: FENCECRAFTERS_THREAD_REPLY_TO_EMAIL },
        to: [{ email: leads[0].customer_email, name: leads[0].customer_name || undefined }],
        subject,
        textContent: text,
            htmlContent: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;white-space:pre-wrap">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`,
            attachment: attachments.slice(0, 5).map((att: { name?: string; dataBase64?: string }) => ({
              name: String(att.name || 'attachment').slice(0, 180),
              content: String(att.dataBase64 || '').replace(/^data:[^;]+;base64,/, ''),
            })).filter((att: { content: string }) => att.content),
          }),
    });
    if (!res.ok) return NextResponse.json({ error: `Email send failed: ${await res.text()}` }, { status: 502 });
  }

  await sql`
    UPDATE crm_leads
    SET updated_at = NOW(),
        last_message_by = ${fromStaff ? 'you' : 'customer'},
        last_message_at = NOW(),
        is_read = ${fromStaff},
        customer_responded = CASE WHEN ${fromStaff} THEN customer_responded ELSE true END,
        outreach_paused = CASE WHEN ${fromStaff} THEN outreach_paused ELSE true END
    WHERE id = ${leadId}
  `;
  if (!fromStaff && leads[0].campaign_id && !leads[0].outreach_paused) {
    await sql`
      INSERT INTO crm_activity (crm_lead_id, activity_type, description, is_from_customer, created_by)
      VALUES (${leadId}, 'status_change', '✅ Campaign completed: customer replied', false, 'campaign_system')
    `;
  }

  return NextResponse.json({ success: true });
}
