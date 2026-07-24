import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { normalizeCrmProfile } from '@/lib/email-policy';

function normalizePhone(value: any): string | null {
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;
  const digits = s.replace(/\D/g, '');
  if (digits.length === 10) return `+1 (${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  return s;
}

function str(value: any): string | null {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s || null;
}

function isLikelyAngiLead(body: any): boolean {
  if (!body || typeof body !== 'object') return false;

  // Angi's CRM integration test posts the lead payload directly and may not
  // include a shared secret/header. Keep the endpoint compatible with Angi by
  // accepting their lead-shaped payloads while still rejecting generic posts.
  const hasAngiIds = Boolean(body.leadOid || body.srOid || body.spEntityId);
  const hasContact = Boolean(
    body.name ||
    body.firstName ||
    body.lastName ||
    body.primaryPhone ||
    body.phone ||
    body.email
  );
  const hasAngiContext = Boolean(
    body.taskName ||
    body.matchType ||
    body.contactStatus ||
    body.spCompanyName ||
    Array.isArray(body.interview)
  );

  return hasAngiIds && hasContact && hasAngiContext;
}

function isAuthorized(request: NextRequest, body: any): boolean {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token') || request.headers.get('x-webhook-token') || body?.crmKey || '';
  const expected = process.env.ANGI_WEBHOOK_TOKEN || process.env.ADMIN_TOKEN || 'hc-admin-2026';
  return token === expected || isLikelyAngiLead(body);
}

function buildNotes(body: any): string {
  const parts: string[] = [];
  if (body.comments) parts.push(`Comments: ${body.comments}`);
  if (body.leadDescription) parts.push(`Lead description: ${body.leadDescription}`);
  if (body.matchType) parts.push(`Match type: ${body.matchType}`);
  if (body.contactStatus) parts.push(`Contact status: ${body.contactStatus}`);
  if (body.fee !== undefined && body.fee !== null) parts.push(`Angi fee: $${body.fee}`);
  if (body.leadOid) parts.push(`Angi leadOid: ${body.leadOid}`);
  if (body.srOid) parts.push(`Angi srOid: ${body.srOid}`);
  if (body.spEntityId) parts.push(`Angi spEntityId: ${body.spEntityId}`);
  if (body.spCompanyName) parts.push(`Angi company: ${body.spCompanyName}`);
  if (body.automatedContactCompliant !== undefined) parts.push(`Automated contact compliant: ${body.automatedContactCompliant}`);

  if (Array.isArray(body.interview) && body.interview.length) {
    parts.push('Interview:');
    for (const item of body.interview) {
      const q = str(item?.question);
      const a = str(item?.answer);
      if (q || a) parts.push(`- ${q || 'Question'}: ${a || ''}`);
    }
  }

  if (body.appointment) {
    parts.push(`Appointment: ${JSON.stringify(body.appointment)}`);
  }

  return parts.join('\n');
}

function profileFromRequest(request: NextRequest, body: any) {
  const { searchParams } = new URL(request.url);
  const explicit = searchParams.get('profile') || body?.crm_profile || body?.profile || body?.crmProfile;
  if (explicit) return normalizeCrmProfile(explicit);
  const company = String(body?.spCompanyName || body?.company || body?.brand || '').toLowerCase();
  if (company.includes('pnm')) return 'pnm_fencing';
  return 'fencecrafters';
}

export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!isAuthorized(request, body)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const name = str(body.name) || [str(body.firstName), str(body.lastName)].filter(Boolean).join(' ') || null;
  const phone = normalizePhone(body.primaryPhone || body.phone || body.customer_phone);
  const secondaryPhone = normalizePhone(body.secondaryPhone);
  const email = str(body.email || body.customer_email);
  const address = str(body.address);
  const city = str(body.city);
  const state = str(body.stateProvince || body.state || 'NJ');
  const zip = str(body.postalCode || body.zip);
  const service = str(body.taskName) || 'Fencing';
  const crmProfile = profileFromRequest(request, body);
  let notes = buildNotes(body);
  notes = `${notes}${notes ? '\n' : ''}CRM profile: ${crmProfile}`;
  if (secondaryPhone) notes = `${notes}${notes ? '\n' : ''}Secondary phone: ${secondaryPhone}`;

  if (!name && !phone && !email) {
    return NextResponse.json({ error: 'Missing customer identity' }, { status: 400 });
  }

  const leadOid = str(body.leadOid);
  if (leadOid) {
    const existingByOid = await sql`SELECT * FROM crm_leads WHERE source = 'angi' AND COALESCE(crm_profile, 'fencecrafters') = ${crmProfile} AND notes ILIKE ${`%Angi leadOid: ${leadOid}%`} LIMIT 1`;
    if (existingByOid.length) {
      return NextResponse.json({ success: true, created: false, duplicate: true, lead: existingByOid[0] });
    }
  }

  if (phone) {
    const existing = await sql`SELECT * FROM crm_leads WHERE customer_phone = ${phone} AND COALESCE(crm_profile, 'fencecrafters') = ${crmProfile} LIMIT 1`;
    if (existing.length) {
      await sql`INSERT INTO crm_activity (crm_lead_id, activity_type, description, is_from_customer) VALUES (${existing[0].id}, 'note', ${`Duplicate Angi lead received${leadOid ? ` (leadOid ${leadOid})` : ''}.`}, true)`;
      return NextResponse.json({ success: true, created: false, duplicate: true, lead: existing[0] });
    }
  }

  if (email) {
    const existing = await sql`SELECT * FROM crm_leads WHERE customer_email = ${email} AND COALESCE(crm_profile, 'fencecrafters') = ${crmProfile} LIMIT 1`;
    if (existing.length) {
      await sql`INSERT INTO crm_activity (crm_lead_id, activity_type, description, is_from_customer) VALUES (${existing[0].id}, 'note', ${`Duplicate Angi lead received${leadOid ? ` (leadOid ${leadOid})` : ''}.`}, true)`;
      return NextResponse.json({ success: true, created: false, duplicate: true, lead: existing[0] });
    }
  }

  const chatToken = [...Array(16)].map(() => Math.random().toString(36)[2]).join('');
  const maxCode = await sql`SELECT COALESCE(MAX(CAST(lead_code AS INTEGER)), 99) + 1 as next_code FROM crm_leads WHERE lead_code ~ '^[0-9]+$'`;
  const leadCode = String(maxCode[0].next_code);

  const defaultCampaign = await sql`
    SELECT id FROM crm_campaigns
    WHERE source = 'angi'
      AND is_default = true
      AND is_active = true
      AND COALESCE(crm_profile, 'fencecrafters') = ${crmProfile}
    ORDER BY id ASC
    LIMIT 1
  `;
  const campaignId = defaultCampaign[0]?.id || null;

  const result = await sql`
    INSERT INTO crm_leads (customer_name, customer_phone, customer_email, customer_address, customer_city, customer_state, customer_zip, service_type, notes, source, status, chat_token, lead_code, is_read, campaign_id, campaign_started_at, crm_profile)
    VALUES (${name}, ${phone}, ${email}, ${address}, ${city}, ${state}, ${zip}, ${service}, ${notes || null}, 'angi', 'new', ${chatToken}, ${leadCode}, false, ${campaignId}, NOW(), ${crmProfile})
    RETURNING *
  `;

  // This is lead intake, not a customer message/reply. Do not set last_message_by here;
  // the Msg Sent / Msg Rcvd filters should only reflect actual SMS/email messages.
  await sql`INSERT INTO crm_activity (crm_lead_id, activity_type, description, is_from_customer) VALUES (${result[0].id}, 'status_change', 'Angi lead received via API integration', false)`;

  return NextResponse.json({ success: true, created: true, lead: result[0] });
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: 'angi-leads' });
}
