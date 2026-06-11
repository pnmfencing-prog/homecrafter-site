import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';

const DAN_PHONE = '9086924847';
const DAN_PHONE_E164 = '+19086924847';
const CRM_BASE_URL = process.env.CRM_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://homecrafter.ai';
const TWILIO_SID = process.env.TWILIO_SID || process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_TOKEN = process.env.TWILIO_TOKEN || process.env.TWILIO_AUTH_TOKEN || '';
const NEW_LEAD_REPLY = 'Hi, this is Scott with FenceCrafters. I was assigned as the estimator for your project.\n\nDid you by chance have a property survey or the total footage or section count?';
const HARD_OPTOUT_RE = /^(stop|stopall|unsubscribe|cancel|end|quit)$/i;
const ANGRY_OPTOUT_RE = /\b(fuck off|f off|leave me alone|do not text|dont text|don't text|remove me|wrong number|not interested|no thanks?|no thank you|i'?m good|im good|i am good|all set|we'?re good|were good)\b/i;

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

function isOptOutOrAngryReply(body: string): boolean {
  const normalized = body.trim();
  return HARD_OPTOUT_RE.test(normalized) || ANGRY_OPTOUT_RE.test(normalized);
}

function isHardOptOutReply(body: string): boolean {
  return HARD_OPTOUT_RE.test(body.trim());
}

function classifyCustomerReply(body: string, attachmentCount = 0): 'promising_reply' | 'neutral_reply' {
  const text = (body || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (attachmentCount > 0) return 'promising_reply';
  if (!text) return 'neutral_reply';

  const promisingPatterns = [
    /\bsurvey\b/,
    /\bfootage\b/,
    /\bfeet\b/,
    /\bft\b/,
    /\bsections?\b/,
    /\bgates?\b/,
    /\bmeasure\b/,
    /\bcome measure\b/,
    /\bcall me\b/,
    /\bgive me a call\b/,
    /\bavailable\b/,
    /\bappointment\b/,
    /\breschedule\b/,
    /\bquote\b/,
    /\bpricing\b/,
    /\bdamaged?\b/,
    /\bpvc\b/,
    /\bwood\b/,
    /\bchain\s*link\b/,
    /\baluminum\b/,
    /\bvinyl\b/,
    /\byes\b/,
    /\b\d+\s*(sections?|gates?|feet|ft)\b/,
  ];

  return promisingPatterns.some((pattern) => pattern.test(text)) ? 'promising_reply' : 'neutral_reply';
}

function extensionFromMime(mimeType: string): string {
  const clean = (mimeType || '').toLowerCase().split(';')[0].trim();
  if (clean === 'image/jpeg' || clean === 'image/jpg') return 'jpg';
  if (clean === 'image/png') return 'png';
  if (clean === 'image/gif') return 'gif';
  if (clean === 'image/webp') return 'webp';
  if (clean === 'application/pdf') return 'pdf';
  if (clean.includes('/')) return clean.split('/')[1].replace(/[^a-z0-9]/g, '').slice(0, 8) || 'bin';
  return 'bin';
}

async function collectTwilioMedia(form: FormData): Promise<Array<{ fileName: string; mimeType: string; contentBase64: string; sizeBytes: number }>> {
  const count = Math.min(Number(form.get('NumMedia') || 0) || 0, 10);
  if (!count) return [];

  const auth = TWILIO_SID && TWILIO_TOKEN ? Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64') : '';
  const attachments = [];
  for (let i = 0; i < count; i += 1) {
    const mediaUrl = String(form.get(`MediaUrl${i}`) || '');
    const mimeType = String(form.get(`MediaContentType${i}`) || 'application/octet-stream').slice(0, 120);
    if (!mediaUrl) continue;

    try {
      const res = await fetch(mediaUrl, {
        headers: auth ? { Authorization: `Basic ${auth}` } : undefined,
      });
      if (!res.ok) {
        console.error(`Twilio media fetch failed (${res.status}) for ${mediaUrl}`);
        continue;
      }
      const arrayBuffer = await res.arrayBuffer();
      const buf = Buffer.from(arrayBuffer);
      if (!buf.length) continue;
      attachments.push({
        fileName: `sms-attachment-${Date.now()}-${i + 1}.${extensionFromMime(mimeType)}`.slice(0, 180),
        mimeType,
        contentBase64: buf.toString('base64'),
        sizeBytes: buf.length,
      });
    } catch (err) {
      console.error('Twilio media fetch error', err);
    }
  }
  return attachments;
}

async function findContractorByPhone(from: string): Promise<any | null> {
  const normalized = normalizePhone(from);
  const matches = await sql`
    SELECT id, name, phone, category
    FROM contractors
    WHERE regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') IN (${normalized}, ${`1${normalized}`})
    ORDER BY active DESC, id ASC
    LIMIT 1
  `;
  return matches[0] || null;
}

async function logContractorSmsReply(contractor: any, from: string, body: string): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS contractor_sms_replies (
      id SERIAL PRIMARY KEY,
      contractor_id INTEGER,
      contractor_name TEXT,
      contractor_phone TEXT,
      category TEXT,
      message TEXT NOT NULL,
      created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
    )
  `;
  await sql`
    INSERT INTO contractor_sms_replies (contractor_id, contractor_name, contractor_phone, category, message)
    VALUES (${contractor.id}, ${contractor.name || null}, ${formatPhone(from)}, ${contractor.category || null}, ${body})
  `;
}

async function findOrCreateLead(from: string): Promise<{ lead: any; created: boolean }> {
  const normalized = normalizePhone(from);
  const matches = await sql`
    SELECT * FROM crm_leads
    WHERE regexp_replace(coalesce(customer_phone, ''), '[^0-9]', '', 'g') IN (${normalized}, ${`1${normalized}`})
    ORDER BY updated_at DESC
    LIMIT 1
  `;

  if (matches.length) return { lead: matches[0], created: false };

  const maxCode = await sql`SELECT COALESCE(MAX(CAST(lead_code AS INTEGER)), 99) + 1 as next_code FROM crm_leads WHERE lead_code ~ '^[0-9]+$'`;
  const leadCode = String(maxCode[0].next_code);
  const chatToken = [...Array(16)].map(() => Math.random().toString(36)[2]).join('');
  const displayPhone = formatPhone(from);
  const created = await sql`
    INSERT INTO crm_leads (customer_name, customer_phone, source, status, chat_token, lead_code, notes, customer_responded, is_read, last_message_by, last_message_at)
    VALUES (${`Unknown texter ${displayPhone}`}, ${displayPhone}, 'angi_sms', 'new', ${chatToken}, ${leadCode}, 'Created automatically from incoming text message', true, false, 'customer', NOW())
    RETURNING *
  `;
  await sql`INSERT INTO crm_activity (crm_lead_id, activity_type, description) VALUES (${created[0].id}, 'status_change', 'Lead created from incoming SMS')`;
  return { lead: created[0], created: true };
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const from = String(form.get('From') || '');
  const body = String(form.get('Body') || '').trim();
  const inboundAttachments = await collectTwilioMedia(form);
  let notificationText = '';
  let newLeadAutoReply = '';
  let suppressAnyReply = false;
  let lead: any = null;

  if (from && (body || inboundAttachments.length)) {
    const contractor = await findContractorByPhone(from);

    if (contractor) {
      await logContractorSmsReply(contractor, from, body);
      if (normalizePhone(from) !== DAN_PHONE) {
        notificationText = `HomeCrafter contractor reply from ${contractor.name || 'Unknown contractor'} (${formatPhone(from)}): ${body}\n\nNot added to PNM CRM.`;
      }
      suppressAnyReply = true;
    } else {
      const result = await findOrCreateLead(from);
      lead = result.lead;
      const attachmentSummary = inboundAttachments.length ? `📎 ${inboundAttachments.length} attachment${inboundAttachments.length === 1 ? '' : 's'}` : '';
      const messageText = body || 'See attached.';
      const description = `📥 ${messageText}${attachmentSummary ? `\n\n${attachmentSummary}` : ''}`;
      suppressAnyReply = body ? isOptOutOrAngryReply(body) : false;

    // Avoid duplicate CRM entries if Twilio retries the webhook.
    const duplicate = await sql`
      SELECT id FROM crm_activity
      WHERE crm_lead_id = ${lead.id}
        AND activity_type = 'sms'
        AND description = ${description}
        AND created_at > NOW() - INTERVAL '10 minutes'
      LIMIT 1
    `;

    let activityId = duplicate[0]?.id;
    if (!activityId) {
      const inserted = await sql`
        INSERT INTO crm_activity (crm_lead_id, activity_type, description, is_from_customer, created_by)
        VALUES (${lead.id}, 'sms', ${description}, true, 'customer_sms')
        RETURNING id
      `;
      activityId = inserted[0].id;
    }

    if (activityId && inboundAttachments.length) {
      const existingAttachmentCount = await sql`
        SELECT COUNT(*)::int AS count
        FROM crm_attachments
        WHERE crm_activity_id = ${activityId}
      `;
      if (Number(existingAttachmentCount[0]?.count || 0) === 0) {
        for (const att of inboundAttachments) {
          await sql`
            INSERT INTO crm_attachments (crm_activity_id, crm_lead_id, file_name, mime_type, content_base64, size_bytes, direction)
            VALUES (${activityId}, ${lead.id}, ${att.fileName}, ${att.mimeType}, ${att.contentBase64}, ${att.sizeBytes}, 'inbound')
          `;
        }
      }
    }

    if (suppressAnyReply) {
      const hardOptOut = body ? isHardOptOutReply(body) : false;
      await sql`
        UPDATE crm_leads
        SET customer_responded = true,
            outreach_paused = true,
            campaign_id = NULL,
            status = 'lost',
            lost_reason = ${hardOptOut ? 'SMS opt-out (STOP/END)' : 'Opted out / negative SMS reply'},
            is_read = ${hardOptOut ? true : false},
            last_message_by = 'customer',
            last_message_at = NOW(),
            updated_at = NOW(),
            closed_at = NOW()
        WHERE id = ${lead.id}
      `;
    } else {
      const replyStatus = classifyCustomerReply(body || '', inboundAttachments.length);
      await sql`
        UPDATE crm_leads
        SET customer_responded = true,
            is_read = false,
            last_message_by = 'customer',
            last_message_at = NOW(),
            updated_at = NOW(),
            status = CASE
              WHEN status IN ('new', 'contacted', 'promising_reply', 'neutral_reply') THEN ${replyStatus}
              ELSE status
            END
        WHERE id = ${lead.id}
      `;
    }

    if (normalizePhone(from) !== DAN_PHONE) {
      const name = lead.customer_name || `Unknown texter ${formatPhone(from)}`;
      const threadUrl = `${CRM_BASE_URL}/crm.html?lead=${lead.id}`;
      notificationText = `New PNM text from ${name} (${formatPhone(from)}): ${body || '[attachment]'}${inboundAttachments.length ? `\n📎 ${inboundAttachments.length} attachment${inboundAttachments.length === 1 ? '' : 's'}` : ''}\n\nOpen thread: ${threadUrl}`;

      if (result.created && !suppressAnyReply) {
        newLeadAutoReply = NEW_LEAD_REPLY;
        await sql`
          INSERT INTO crm_activity (crm_lead_id, activity_type, description, is_from_customer, created_by)
          VALUES (${lead.id}, 'sms', ${`📤 ${NEW_LEAD_REPLY}`}, false, 'system')
        `;
        await sql`
          UPDATE crm_leads
          SET last_message_by = 'you',
              last_message_at = NOW(),
              last_outreach_at = NOW(),
              outreach_count = coalesce(outreach_count, 0) + 1,
              updated_at = NOW()
          WHERE id = ${lead.id}
        `;
      }
    }
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

  if (newLeadAutoReply) {
    twiml += `<Message>${escapeXml(newLeadAutoReply)}</Message>`;
  } else if (!isBusinessHours && !suppressAnyReply) {
    twiml += "<Message>Thanks for reaching out to PNM Fencing! Our office hours are Mon-Fri 8AM-6PM and Sat 9AM-2PM. We'll get back to you on the next business day. For urgent matters, call (908) 503-5473.</Message>";
  }

  twiml += '</Response>';

  return new NextResponse(twiml, {
    headers: { 'Content-Type': 'text/xml' },
  });
}
