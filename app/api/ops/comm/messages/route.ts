import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { isCrmAdmin, previewText } from '@/lib/crm-admin';
import {
  crmProfileConfig,
  normalizeCrmProfile,
  PNM_FENCING_EMAIL_SENDING_PAUSED,
  pnmFencingEmailPausedResponse,
} from '@/lib/email-policy';
import { assertSmsCapable, normalizeSmsPhone } from '@/lib/sms-guard';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const TWILIO_SID = process.env.TWILIO_SID || process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_TOKEN = process.env.TWILIO_TOKEN || process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_FROM = process.env.TWILIO_FROM || process.env.TWILIO_PHONE_NUMBER || '';
const PNM_TWILIO_FROM = process.env.PNM_TWILIO_FROM || process.env.PNM_TWILIO_NUMBER || '+19083173444';

function twilioFromForProfile(profileValue: unknown): string {
  const profile = normalizeCrmProfile(profileValue);
  if (profile === 'pnm_fencing') return PNM_TWILIO_FROM;
  if (profile === 'lowes_fencing') return process.env.LOWES_TWILIO_NUMBER || process.env.LOWES_TWILIO_FROM || '+19086766984';
  return TWILIO_FROM || '+19085035473';
}

async function sendTwilioSms(to: string, body: string, profileValue?: unknown): Promise<string | null> {
  const fromNumber = twilioFromForProfile(profileValue);
  if (!TWILIO_SID || !TWILIO_TOKEN || !fromNumber) {
    throw new Error('Twilio environment variables are not configured');
  }
  const cleanTo = await assertSmsCapable(to);
  const params = new URLSearchParams();
  params.append('From', fromNumber);
  params.append('To', cleanTo);
  params.append('Body', body);
  const auth = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64');
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  const text = await res.text();
  let payload: any = {};
  try { payload = JSON.parse(text); } catch {}
  if (!res.ok || payload.error_code || payload.code) {
    throw new Error(`Twilio SMS failed: ${text}`);
  }
  return payload.sid || null;
}

async function sendBrevoEmail(opts: {
  profileValue: unknown;
  toEmail: string;
  toName?: string;
  subject: string;
  bodyText: string;
}): Promise<void> {
  if (!process.env.BREVO_API_KEY) {
    throw new Error('Brevo email is not configured');
  }
  const profile = crmProfileConfig(opts.profileValue);
  if (profile.key === 'pnm_fencing' && PNM_FENCING_EMAIL_SENDING_PAUSED) {
    throw new Error(pnmFencingEmailPausedResponse().error);
  }
  const payload = {
    sender: { name: profile.senderName, email: profile.senderEmail },
    replyTo: { name: profile.senderName, email: profile.replyToEmail },
    to: [{ email: opts.toEmail, name: opts.toName || undefined }],
    subject: opts.subject,
    textContent: opts.bodyText,
    htmlContent: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;white-space:pre-wrap">${opts.bodyText
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')}</div>`,
  };
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': process.env.BREVO_API_KEY || '', 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Email send failed: ${errorText}`);
  }
}

function appendSignature(bodyText: string, profileValue: unknown): string {
  const profile = crmProfileConfig(profileValue);
  const sig = String(profile.smsSignature || '').trim();
  const body = String(bodyText || '').trim();
  if (!body || !sig) return body;
  if (body.includes(sig)) return body;
  return `${body}\n\n${sig}`;
}

/**
 * Ops vendor messaging endpoint.
 * Auth: Authorization: Bearer <ADMIN_TOKEN> or x-admin-token: <ADMIN_TOKEN>
 *
 * For channel=sms|email, actually delivers via Twilio/Brevo using crm_profile From identity,
 * then stores the message on crm_comm_*. For channel=in_app|other, stores only (staff note / bot ingest).
 */
export async function POST(request: NextRequest) {
  if (!isCrmAdmin(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  let bodyText = String(body.body_text || body.body || '').trim();
  if (!bodyText) {
    return NextResponse.json({ error: 'body_text is required' }, { status: 400 });
  }

  let threadId = String(body.thread_id || '').trim() || null;
  let vendorId = String(body.vendor_id || '').trim() || null;
  const channel = String(body.channel || 'in_app').trim() || 'in_app';
  const title = String(body.title || (channel === 'sms' ? 'SMS' : channel === 'email' ? 'Email' : 'General')).trim() || 'General';
  const actorType = String(body.actor_type || 'bot').trim();
  const actorLabel = String(body.actor_label || actorType).trim() || actorType;
  const messageKind = String(body.message_kind || 'chat').trim() || 'chat';
  const direction = String(body.direction || (actorType === 'staff' ? 'outbound' : 'inbound')).trim();
  let externalMessageId = body.external_message_id ? String(body.external_message_id) : null;
  const orderPayload = body.order_payload ?? null;
  const crmProfile = normalizeCrmProfile(body.crm_profile || body.profile);
  const emailSubject = String(body.subject || '').trim();
  const deliver = body.deliver !== false && actorType === 'staff' && direction === 'outbound' && (channel === 'sms' || channel === 'email');

  if (!['bot', 'vendor', 'staff'].includes(actorType)) {
    return NextResponse.json({ error: 'actor_type must be bot|vendor|staff' }, { status: 400 });
  }
  if (!['sms', 'email', 'in_app', 'other'].includes(channel)) {
    return NextResponse.json({ error: 'invalid channel' }, { status: 400 });
  }

  if (deliver && channel === 'sms') {
    bodyText = appendSignature(bodyText, crmProfile);
  }
  if (deliver && channel === 'email') {
    bodyText = appendSignature(bodyText, crmProfile);
  }

  let vendorRow: any = null;
  if (!threadId) {
    if (!vendorId) {
      return NextResponse.json({ error: 'vendor_id or thread_id is required' }, { status: 400 });
    }
    const vendor = await sql`
      SELECT id, display_name, primary_phone, primary_email
      FROM crm_vendor_profiles WHERE id = ${vendorId}::uuid LIMIT 1
    `;
    if (!vendor.length) {
      return NextResponse.json({ error: 'Vendor not found' }, { status: 404 });
    }
    vendorRow = vendor[0];

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
    SELECT t.id, t.vendor_id, t.channel, v.display_name, v.primary_phone, v.primary_email
    FROM crm_comm_threads t
    JOIN crm_vendor_profiles v ON v.id = t.vendor_id
    WHERE t.id = ${threadId}::uuid
    LIMIT 1
  `;
  if (!threadRows.length) {
    return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
  }
  vendorId = threadRows[0].vendor_id;
  vendorRow = vendorRow || {
    id: threadRows[0].vendor_id,
    display_name: threadRows[0].display_name,
    primary_phone: threadRows[0].primary_phone,
    primary_email: threadRows[0].primary_email,
  };

  let deliveryStatus = body.delivery_status
    ? String(body.delivery_status)
    : (actorType === 'staff' ? 'sent' : null);

  if (deliver) {
    try {
      if (channel === 'sms') {
        const to = normalizeSmsPhone(String(vendorRow.primary_phone || ''));
        if (!to) return NextResponse.json({ error: 'Vendor phone is missing' }, { status: 400 });
        const sid = await sendTwilioSms(to, bodyText, crmProfile);
        externalMessageId = sid || externalMessageId;
        deliveryStatus = 'sent';
      } else if (channel === 'email') {
        const toEmail = String(vendorRow.primary_email || '').trim();
        if (!toEmail) return NextResponse.json({ error: 'Vendor email is missing' }, { status: 400 });
        const profile = crmProfileConfig(crmProfile);
        const subject = emailSubject || profile.defaultSubject;
        await sendBrevoEmail({
          profileValue: crmProfile,
          toEmail,
          toName: vendorRow.display_name || '',
          subject,
          bodyText,
        });
        deliveryStatus = 'sent';
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Send failed';
      const status = /paused/i.test(message) ? 423 : 502;
      return NextResponse.json({ error: message }, { status });
    }
  }

  const preview = previewText(bodyText);
  const bumpUnread = actorType === 'bot' || actorType === 'vendor';

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
    channel,
    crm_profile: crmProfile,
    delivered: deliver,
    message: messageRows[0],
  });
}
