import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';

function isAdmin(request: NextRequest): boolean {
  const auth = request.headers.get('authorization') || '';
  const token = auth.replace('Bearer ', '');
  return token === (process.env.ADMIN_TOKEN || 'hc-admin-2026');
}

function cleanText(value: unknown): string | null {
  const text = String(value || '').trim();
  return text ? text : null;
}

async function ensureSchema() {
  await sql`
    CREATE TABLE IF NOT EXISTS crm_campaigns (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      source TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      is_default BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS crm_campaign_messages (
      id SERIAL PRIMARY KEY,
      campaign_id INTEGER NOT NULL REFERENCES crm_campaigns(id) ON DELETE CASCADE,
      step_number INTEGER NOT NULL,
      send_day INTEGER NOT NULL DEFAULT 0,
      channel TEXT NOT NULL DEFAULT 'both' CHECK (channel IN ('sms','email','both')),
      sms_body TEXT,
      email_subject TEXT,
      email_body TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(campaign_id, step_number)
    )
  `;
  await sql`ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS campaign_id INTEGER REFERENCES crm_campaigns(id) ON DELETE SET NULL`;
}

export async function GET(request: NextRequest) {
  if (!isAdmin(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureSchema();

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const includeLeads = searchParams.get('includeLeads') === '1';
  const includeNonresponders = searchParams.get('includeNonresponders') === '1';

  const campaigns = id
    ? await sql`
        SELECT c.*,
          COUNT(DISTINCT l.id)::int AS assigned_count
        FROM crm_campaigns c
        LEFT JOIN crm_leads l ON l.campaign_id = c.id AND l.customer_responded = false AND l.outreach_paused = false AND l.status = 'new'
        WHERE c.id = ${Number(id)}
        GROUP BY c.id
        ORDER BY c.created_at DESC
      `
    : await sql`
        SELECT c.*,
          COUNT(DISTINCT l.id)::int AS assigned_count
        FROM crm_campaigns c
        LEFT JOIN crm_leads l ON l.campaign_id = c.id AND l.customer_responded = false AND l.outreach_paused = false AND l.status = 'new'
        GROUP BY c.id
        ORDER BY c.is_default DESC, c.created_at DESC
      `;

  const campaignIds = campaigns.map((c) => c.id);
  const messages = campaignIds.length
    ? await sql`
        SELECT * FROM crm_campaign_messages
        WHERE campaign_id = ANY(${campaignIds})
        ORDER BY campaign_id, step_number ASC
      `
    : [];

  let leads: any[] = [];
  if (includeLeads) {
    leads = await sql`
      WITH default_angi_campaign AS (
        SELECT id, name
        FROM crm_campaigns
        WHERE source = 'angi' AND is_default = true AND is_active = true
        ORDER BY id ASC
        LIMIT 1
      ), lead_base AS (
        SELECT
          l.*,
          CASE
            WHEN l.campaign_id IS NOT NULL THEN l.campaign_id
            WHEN l.source = 'angi' THEN (SELECT id FROM default_angi_campaign)
            ELSE NULL
          END AS effective_campaign_id
        FROM crm_leads l
      )
      SELECT
        l.id, l.lead_code, l.customer_name, l.customer_phone, l.customer_email, l.source, l.status,
        l.effective_campaign_id AS campaign_id, l.outreach_count, l.email_outreach_count, l.customer_responded, l.outreach_paused, l.created_at,
        camp.name AS campaign_name,
        COALESCE(steps.sms_steps, 0)::int AS campaign_sms_steps,
        COALESCE(steps.email_steps, 0)::int AS campaign_email_steps,
        (
          l.effective_campaign_id IS NOT NULL
          AND (COALESCE(steps.sms_steps, 0) > 0 OR COALESCE(steps.email_steps, 0) > 0)
          AND COALESCE(l.outreach_count, 0) >= COALESCE(steps.sms_steps, 0)
          AND COALESCE(l.email_outreach_count, 0) >= COALESCE(steps.email_steps, 0)
        ) AS campaign_completed
      FROM lead_base l
      LEFT JOIN crm_campaigns camp ON camp.id = l.effective_campaign_id
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(MAX(step_number) FILTER (WHERE channel IN ('sms', 'both') AND COALESCE(sms_body, '') <> ''), 0)::int AS sms_steps,
          COALESCE(MAX(step_number) FILTER (WHERE channel IN ('email', 'both') AND COALESCE(email_body, sms_body, '') <> ''), 0)::int AS email_steps
        FROM crm_campaign_messages
        WHERE campaign_id = l.effective_campaign_id AND is_active = true
      ) steps ON true
      ORDER BY l.created_at DESC
      LIMIT 1000
    `;
  }

  let nonresponders: any[] = [];
  if (includeNonresponders) {
    nonresponders = await sql`
      SELECT lead_id, lead_code, customer_name, customer_phone, customer_email, customer_city, service_type,
             source, status, created_at, last_outreach_at, outreach_count, email_outreach_count,
             customer_responded, outreach_paused, campaign_id, campaign_name, campaign_sms_steps,
             final_send_day, days_since_last_outreach
      FROM crm_campaign_nonresponders
      WHERE campaign_id IS NOT NULL
        AND customer_responded = false
        AND outreach_paused = false
        AND outreach_count >= campaign_sms_steps
        AND COALESCE(email_outreach_count, 0) >= campaign_sms_steps
        AND days_since_last_outreach >= 1
      ORDER BY last_outreach_at ASC NULLS LAST, created_at ASC
      LIMIT 1000
    `;
  }

  return NextResponse.json({ campaigns, messages, leads, nonresponders });
}

export async function POST(request: NextRequest) {
  if (!isAdmin(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureSchema();
  const body = await request.json();
  const action = body.action;

  if (action === 'create_campaign') {
    const name = cleanText(body.name);
    if (!name) return NextResponse.json({ error: 'Campaign name required' }, { status: 400 });
    const rows = await sql`
      INSERT INTO crm_campaigns (name, description, source, is_active, is_default)
      VALUES (${name}, ${cleanText(body.description)}, ${cleanText(body.source)}, ${body.is_active !== false}, ${body.is_default === true})
      RETURNING *
    `;
    return NextResponse.json({ success: true, campaign: rows[0] });
  }

  if (action === 'update_campaign') {
    const id = Number(body.id);
    if (!id) return NextResponse.json({ error: 'Campaign id required' }, { status: 400 });
    await sql`
      UPDATE crm_campaigns
      SET name = ${cleanText(body.name)}, description = ${cleanText(body.description)}, source = ${cleanText(body.source)},
          is_active = ${body.is_active !== false}, is_default = ${body.is_default === true}, updated_at = NOW()
      WHERE id = ${id}
    `;
    if (body.is_default === true && cleanText(body.source)) {
      await sql`UPDATE crm_campaigns SET is_default = false WHERE id <> ${id} AND source = ${cleanText(body.source)}`;
    }
    return NextResponse.json({ success: true });
  }

  if (action === 'upsert_message') {
    const campaignId = Number(body.campaign_id);
    const stepNumber = Number(body.step_number);
    if (!campaignId || !stepNumber) return NextResponse.json({ error: 'Campaign and step number required' }, { status: 400 });
    const sendDay = Math.max(0, Number(body.send_day ?? 0));
    const channel = ['sms', 'email', 'both'].includes(body.channel) ? body.channel : 'both';
    const rows = await sql`
      INSERT INTO crm_campaign_messages (campaign_id, step_number, send_day, channel, sms_body, email_subject, email_body, is_active)
      VALUES (${campaignId}, ${stepNumber}, ${sendDay}, ${channel}, ${cleanText(body.sms_body)}, ${cleanText(body.email_subject)}, ${cleanText(body.email_body)}, ${body.is_active !== false})
      ON CONFLICT (campaign_id, step_number) DO UPDATE SET
        send_day = EXCLUDED.send_day,
        channel = EXCLUDED.channel,
        sms_body = EXCLUDED.sms_body,
        email_subject = EXCLUDED.email_subject,
        email_body = EXCLUDED.email_body,
        is_active = EXCLUDED.is_active,
        updated_at = NOW()
      RETURNING *
    `;
    return NextResponse.json({ success: true, message: rows[0] });
  }

  if (action === 'delete_message') {
    await sql`DELETE FROM crm_campaign_messages WHERE id = ${Number(body.id)}`;
    return NextResponse.json({ success: true });
  }

  if (action === 'assign_lead') {
    const leadId = Number(body.lead_id);
    const campaignId = body.campaign_id ? Number(body.campaign_id) : null;
    if (!leadId) return NextResponse.json({ error: 'Lead id required' }, { status: 400 });
    await sql`
      UPDATE crm_leads
      SET campaign_id = ${campaignId}, outreach_count = 0, last_outreach_at = NULL, customer_responded = false, outreach_paused = false, updated_at = NOW()
      WHERE id = ${leadId}
    `;
    return NextResponse.json({ success: true });
  }

  if (action === 'bulk_assign') {
    const leadIds = Array.isArray(body.lead_ids) ? body.lead_ids.map(Number).filter(Boolean) : [];
    const campaignId = body.campaign_id ? Number(body.campaign_id) : null;
    if (!leadIds.length) return NextResponse.json({ error: 'No leads selected' }, { status: 400 });
    await sql`
      UPDATE crm_leads
      SET campaign_id = ${campaignId}, outreach_count = 0, last_outreach_at = NULL, customer_responded = false, outreach_paused = false, updated_at = NOW()
      WHERE id = ANY(${leadIds})
    `;
    return NextResponse.json({ success: true, count: leadIds.length });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
