import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';

const DAN_PHONE = '7323376181';
const DAN_PHONE_E164 = '+17323376181';
const CRM_BASE_URL = process.env.CRM_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://homecrafter.ai';

function normalizePhone(phone: string): string {
  const digits = (phone || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits;
}

function formatPhone(phone: string): string {
  const digits = normalizePhone(phone);
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return phone;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function findOrCreateLead(from: string) {
  const normalized = normalizePhone(from);
  const matches = await sql`
    SELECT * FROM crm_leads
    WHERE regexp_replace(coalesce(customer_phone, ''), '[^0-9]', '', 'g') IN (${normalized}, ${`1${normalized}`})
    ORDER BY updated_at DESC
    LIMIT 1
  `;

  if (matches.length) return matches[0];

  const maxCode = await sql`SELECT COALESCE(MAX(CAST(lead_code AS INTEGER)), 99) + 1 as next_code FROM crm_leads WHERE lead_code ~ '^[0-9]+$'`;
  const leadCode = String(maxCode[0].next_code);
  const chatToken = [...Array(16)].map(() => Math.random().toString(36)[2]).join('');
  const displayPhone = formatPhone(from);
  const created = await sql`
    INSERT INTO crm_leads (customer_name, customer_phone, source, status, chat_token, lead_code, notes, customer_responded, is_read, last_message_by, last_message_at)
    VALUES (${`Unknown texter ${displayPhone}`}, ${displayPhone}, 'sms', 'new', ${chatToken}, ${leadCode}, 'Created automatically from incoming text message', true, false, 'customer', NOW())
    RETURNING *
  `;
  await sql`INSERT INTO crm_activity (crm_lead_id, activity_type, description) VALUES (${created[0].id}, 'status_change', 'Lead created from incoming SMS')`;
  return created[0];
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const from = String(form.get('From') || '');
  const body = String(form.get('Body') || '').trim();
  let notificationText = '';

  if (from && body) {
    const lead = await findOrCreateLead(from);
    const description = `📥 ${body}`;

    // Avoid duplicate CRM entries if Twilio retries the webhook.
    const duplicate = await sql`
      SELECT id FROM crm_activity
      WHERE crm_lead_id = ${lead.id}
        AND activity_type = 'sms'
        AND description = ${description}
        AND created_at > NOW() - INTERVAL '10 minutes'
      LIMIT 1
    `;

    if (!duplicate.length) {
      await sql`
        INSERT INTO crm_activity (crm_lead_id, activity_type, description, is_from_customer)
        VALUES (${lead.id}, 'sms', ${description}, true)
      `;
    }

    await sql`
      UPDATE crm_leads
      SET customer_responded = true,
          is_read = false,
          last_message_by = 'customer',
          last_message_at = NOW(),
          updated_at = NOW()
      WHERE id = ${lead.id}
    `;

    if (normalizePhone(from) !== DAN_PHONE) {
      const name = lead.customer_name || `Unknown texter ${formatPhone(from)}`;
      const threadUrl = `${CRM_BASE_URL}/crm.html?lead=${lead.id}`;
      notificationText = `New PNM text from ${name} (${formatPhone(from)}): ${body}\n\nOpen thread: ${threadUrl}`;
    }
  }

  const now = new Date();
  const est = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const hour = est.getHours();
  const day = est.getDay();

  const isBusinessHours =
    (day >= 1 && day <= 5 && hour >= 8 && hour < 18) ||
    (day === 6 && hour >= 9 && hour < 14);

  let twiml = '<?xml version="1.0" encoding="UTF-8"?><Response>';

  if (notificationText) {
    twiml += `<Message to="${DAN_PHONE_E164}">${escapeXml(notificationText.slice(0, 1200))}</Message>`;
  }

  if (!isBusinessHours) {
    twiml += "<Message>Thanks for reaching out to PNM Fencing! Our office hours are Mon-Fri 8AM-6PM and Sat 9AM-2PM. We'll get back to you on the next business day. For urgent matters, call (732) 337-6181.</Message>";
  }

  twiml += '</Response>';

  return new NextResponse(twiml, {
    headers: { 'Content-Type': 'text/xml' },
  });
}
