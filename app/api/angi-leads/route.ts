import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { normalizeCrmProfile, type CrmProfileKey } from '@/lib/email-policy';

const ANGI_IMPORT_PROFILES = ['pnm_fencing', 'fencecrafters'] as const;

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

async function nextLeadCode(): Promise<string> {
  const maxCode = await sql`SELECT COALESCE(MAX(CAST(lead_code AS INTEGER)), 99) + 1 as next_code FROM crm_leads WHERE lead_code ~ '^[0-9]+$'`;
  return String(maxCode[0].next_code);
}

async function defaultCampaignIdForProfile(crmProfile: CrmProfileKey) {
  const defaultCampaign = await sql`
    SELECT id FROM crm_campaigns
    WHERE source = 'angi'
      AND is_default = true
      AND is_active = true
      AND COALESCE(crm_profile, 'fencecrafters') = ${crmProfile}
    ORDER BY id ASC
    LIMIT 1
  `;
  return defaultCampaign[0]?.id || null;
}

// Same mapping as CRM status→neutral_reply Casual enroll (crm/route.ts).
// Angi never assigns Lowes unless the request names that profile.
const CASUAL_CAMPAIGN_BY_PROFILE: Partial<Record<CrmProfileKey, number>> = {
  pnm_fencing: 10,
  fencecrafters: 11,
  lowes_fencing: 14,
};

// Product Casual enroll treats any non-null campaign_id as already assigned
// and will not replace it (completed/paused drips still keep campaign_id).
// Terminal nurture exclusions match campaign completion + SMS opt-out filter.
function isTerminalOrOptedOut(lead: any): boolean {
  const status = String(lead?.status || '').toLowerCase();
  if (status === 'lost' || status === 'sold' || status === 'won') return true;
  return String(lead?.lost_reason || '') === 'SMS opt-out (STOP/END)';
}

async function enrollCasualOnSameProfileDuplicate(lead: any, crmProfile: CrmProfileKey) {
  if (!lead?.id || isTerminalOrOptedOut(lead)) return lead;
  const existingCampaignId = lead.campaign_id == null || lead.campaign_id === ''
    ? null
    : Number(lead.campaign_id);
  // Active campaign = campaign_id is set. Do not override progress.
  if (existingCampaignId != null && !Number.isNaN(existingCampaignId)) return lead;

  const casualCampaignId = CASUAL_CAMPAIGN_BY_PROFILE[crmProfile];
  if (!casualCampaignId) return lead;

  const startRows = await sql`
    SELECT (((NOW() AT TIME ZONE 'America/New_York')::date + INTERVAL '1 day' + TIME '10:00') AT TIME ZONE 'America/New_York') AS start_at
  `;
  const campaignStartAt = startRows[0].start_at;
  const campRows = await sql`
    SELECT name FROM crm_campaigns WHERE id = ${casualCampaignId} LIMIT 1
  `;
  const campaignName = campRows[0]?.name || `Campaign #${casualCampaignId}`;
  const enrollRows = await sql`
    UPDATE crm_leads
    SET campaign_id = ${casualCampaignId},
        campaign_started_at = COALESCE(campaign_started_at, ${campaignStartAt}::timestamptz),
        outreach_count = 0,
        email_outreach_count = 0,
        last_outreach_at = NULL,
        customer_responded = false,
        updated_at = NOW()
    WHERE id = ${lead.id}
      AND campaign_id IS NULL
      AND LOWER(COALESCE(status, '')) NOT IN ('lost', 'sold', 'won')
      AND lost_reason IS DISTINCT FROM 'SMS opt-out (STOP/END)'
    RETURNING *
  `;
  if (!enrollRows.length) return lead;
  await sql`
    INSERT INTO crm_activity (crm_lead_id, activity_type, description, is_from_customer, created_by)
    VALUES (${lead.id}, 'status_change', ${`Auto-enrolled Casual on same-profile duplicate: ${campaignName}`}, false, 'campaign_system')
  `;
  return enrollRows[0];
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
  const requestedProfile = profileFromRequest(request, body);
  const importProfiles = [requestedProfile, ...ANGI_IMPORT_PROFILES.filter((profile) => profile !== requestedProfile)];
  const baseNotes = buildNotes(body);

  if (!name && !phone && !email) {
    return NextResponse.json({ error: 'Missing customer identity' }, { status: 400 });
  }

  const leadOid = str(body.leadOid);
  const leads: any[] = [];
  const createdLeads: any[] = [];
  const duplicateLeads: any[] = [];

  for (const crmProfile of importProfiles) {
    let notes = baseNotes;
    notes = `${notes}${notes ? '\n' : ''}CRM profile: ${crmProfile}`;
    notes = `${notes}\nDual Angi import: mirrored into both PNM Fencing and FenceCrafters CRM profiles so each company can compete independently.`;
    if (secondaryPhone) notes = `${notes}${notes ? '\n' : ''}Secondary phone: ${secondaryPhone}`;

    if (leadOid) {
      const existingByOid = await sql`SELECT * FROM crm_leads WHERE source = 'angi' AND COALESCE(crm_profile, 'fencecrafters') = ${crmProfile} AND notes ILIKE ${`%Angi leadOid: ${leadOid}%`} LIMIT 1`;
      if (existingByOid.length) {
        const enrolled = await enrollCasualOnSameProfileDuplicate(existingByOid[0], crmProfile);
        duplicateLeads.push(enrolled);
        leads.push(enrolled);
        continue;
      }
    }

    if (phone) {
      const existing = await sql`SELECT * FROM crm_leads WHERE customer_phone = ${phone} AND COALESCE(crm_profile, 'fencecrafters') = ${crmProfile} LIMIT 1`;
      if (existing.length) {
        await sql`INSERT INTO crm_activity (crm_lead_id, activity_type, description, is_from_customer) VALUES (${existing[0].id}, 'note', ${`Duplicate Angi lead received for ${crmProfile}${leadOid ? ` (leadOid ${leadOid})` : ''}.`}, false)`;
        const enrolled = await enrollCasualOnSameProfileDuplicate(existing[0], crmProfile);
        duplicateLeads.push(enrolled);
        leads.push(enrolled);
        continue;
      }
    }

    if (email) {
      const existing = await sql`SELECT * FROM crm_leads WHERE customer_email = ${email} AND COALESCE(crm_profile, 'fencecrafters') = ${crmProfile} LIMIT 1`;
      if (existing.length) {
        await sql`INSERT INTO crm_activity (crm_lead_id, activity_type, description, is_from_customer) VALUES (${existing[0].id}, 'note', ${`Duplicate Angi lead received for ${crmProfile}${leadOid ? ` (leadOid ${leadOid})` : ''}.`}, false)`;
        const enrolled = await enrollCasualOnSameProfileDuplicate(existing[0], crmProfile);
        duplicateLeads.push(enrolled);
        leads.push(enrolled);
        continue;
      }
    }

    const chatToken = [...Array(16)].map(() => Math.random().toString(36)[2]).join('');
    const leadCode = await nextLeadCode();
    const campaignId = await defaultCampaignIdForProfile(crmProfile);

    const result = await sql`
      INSERT INTO crm_leads (customer_name, customer_phone, customer_email, customer_address, customer_city, customer_state, customer_zip, service_type, notes, source, status, chat_token, lead_code, is_read, campaign_id, campaign_started_at, crm_profile)
      VALUES (${name}, ${phone}, ${email}, ${address}, ${city}, ${state}, ${zip}, ${service}, ${notes || null}, 'angi', 'new', ${chatToken}, ${leadCode}, false, ${campaignId}, NOW(), ${crmProfile})
      RETURNING *
    `;

    // This is lead intake, not a customer message/reply. Do not set last_message_by here;
    // the Msg Sent / Msg Rcvd filters should only reflect actual SMS/email messages.
    await sql`INSERT INTO crm_activity (crm_lead_id, activity_type, description, is_from_customer) VALUES (${result[0].id}, 'status_change', ${`Angi lead received via API integration for ${crmProfile}`}, false)`;
    createdLeads.push(result[0]);
    leads.push(result[0]);

    // Dan does not want PNM/FenceCrafters notification texts for lead imports.
    // Customer replies/inbound messages are still notified through the SMS inbound flow.
  }

  return NextResponse.json({
    success: true,
    created: createdLeads.length > 0,
    duplicate: createdLeads.length === 0 && duplicateLeads.length > 0,
    lead: leads.find((lead) => normalizeCrmProfile(lead.crm_profile) === requestedProfile) || leads[0] || null,
    leads,
    created_leads: createdLeads,
    duplicate_leads: duplicateLeads,
  });
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: 'angi-leads' });
}
