import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { normalizeCrmProfile } from '@/lib/email-policy';

function isAdmin(request: NextRequest): boolean {
  const auth = request.headers.get('authorization') || '';
  const token = auth.replace('Bearer ', '');
  return token === (process.env.ADMIN_TOKEN || 'hc-admin-2026');
}

function cleanText(value: unknown): string | null {
  const text = String(value || '').trim();
  return text ? text : null;
}

function shouldStartTomorrowAt10(campaign: { name?: string | null; source?: string | null } | null | undefined): boolean {
  const name = String(campaign?.name || '').toLowerCase();
  const source = String(campaign?.source || '').toLowerCase();
  return name.includes('quote follow up') && (source === 'angi' || source === 'batchleads');
}

async function nextCampaignStartExpression(campaignId: number | null, campaign: { name?: string | null; source?: string | null } | null | undefined) {
  if (!campaignId) return null;
  if (shouldStartTomorrowAt10(campaign)) {
    const rows = await sql`
      SELECT (((NOW() AT TIME ZONE 'America/New_York')::date + INTERVAL '1 day' + TIME '10:00') AT TIME ZONE 'America/New_York') AS start_at
    `;
    return rows[0].start_at;
  }
  const rows = await sql`SELECT NOW() AS start_at`;
  return rows[0].start_at;
}

// Dan rule 2026-10-08 8:34 PM ET: (re)assigning a lead to the SAME campaign it is already on
// continues where it left off (outreach_count / email_outreach_count kept, never back to step 1).
// Only a DIFFERENT campaign starts at step 1. campaign_started_at is kept unless the next unsent
// step is already overdue; then the schedule shifts so exactly that ONE step is due now (sent at the
// next sender cycle, quiet hours apply) and later steps keep their spacing — no burst of overdue
// steps. A future (deferred) start is never pulled earlier. Mirrors claw scripts/campaign_continue.py.
// Root cause of Michele Nargi 12144 getting step 1 three times on 10/6 (Assign pressed again).
const OUTREACH_FLOOR = process.env.CRM_AUTO_OUTREACH_START_AT || '2026-08-20T00:00:00Z';

type ContinueResult = {
  id: number;
  oc: number;
  ec: number;
  next_step: number | null;
  next_due_at: string | Date | null;
};

async function continueSameCampaign(leadId: number, campaignId: number, profile: string): Promise<ContinueResult | null> {
  const rows = await sql`
    WITH l AS (
      SELECT id, campaign_id,
             COALESCE(outreach_count, 0) AS oc,
             COALESCE(email_outreach_count, 0) AS ec,
             COALESCE(campaign_started_at, created_at) AS base,
             campaign_started_at,
             COALESCE(customer_phone, '') <> '' AS has_phone,
             COALESCE(customer_email, '') <> '' AS has_email
      FROM crm_leads
      WHERE id = ${leadId} AND campaign_id = ${campaignId} AND COALESCE(crm_profile, 'fencecrafters') = ${profile}
    ), stag AS (
      SELECT EXISTS (
        SELECT 1 FROM crm_campaign_messages x JOIN l ON x.campaign_id = l.campaign_id
        WHERE x.is_active = true AND x.channel = 'email'
      ) AS s
    ), sms_track AS (
      SELECT m.step_number, m.send_day, ROW_NUMBER() OVER (ORDER BY m.step_number) AS rn
      FROM crm_campaign_messages m JOIN l ON m.campaign_id = l.campaign_id
      WHERE m.is_active = true AND m.channel IN ('sms', 'both') AND COALESCE(m.sms_body, '') <> ''
    ), email_track AS (
      SELECT m.step_number, m.send_day, ROW_NUMBER() OVER (ORDER BY m.step_number) AS rn
      FROM crm_campaign_messages m JOIN l ON m.campaign_id = l.campaign_id
      WHERE m.is_active = true AND m.channel IN ('email', 'both') AND COALESCE(m.email_body, m.sms_body, '') <> ''
    ), nxt AS (
      SELECT
        (SELECT s.step_number FROM sms_track s, l WHERE s.rn = l.oc + 1 AND l.has_phone) AS sms_step,
        (SELECT s.send_day    FROM sms_track s, l WHERE s.rn = l.oc + 1 AND l.has_phone) AS sms_day,
        (SELECT e.step_number FROM email_track e, l, stag WHERE e.rn = l.ec + 1 AND l.has_email AND (stag.s OR NOT l.has_phone)) AS email_step,
        (SELECT e.send_day    FROM email_track e, l, stag WHERE e.rn = l.ec + 1 AND l.has_email AND (stag.s OR NOT l.has_phone)) AS email_day
    ), plan AS (
      SELECT l.id, l.oc, l.ec,
             LEAST(nxt.sms_day, nxt.email_day) AS next_day,
             CASE
               WHEN nxt.sms_day IS NULL THEN nxt.email_step
               WHEN nxt.email_day IS NULL THEN nxt.sms_step
               WHEN nxt.email_day < nxt.sms_day THEN nxt.email_step
               ELSE nxt.sms_step
             END AS next_step,
             CASE
               WHEN LEAST(nxt.sms_day, nxt.email_day) IS NULL THEN l.campaign_started_at
               WHEN l.base < ${OUTREACH_FLOOR}::timestamptz
                 THEN GREATEST(${OUTREACH_FLOOR}::timestamptz, NOW() - LEAST(nxt.sms_day, nxt.email_day) * INTERVAL '1 day')
               ELSE GREATEST(l.base, NOW() - LEAST(nxt.sms_day, nxt.email_day) * INTERVAL '1 day')
             END AS new_started_at
      FROM l, nxt
    )
    UPDATE crm_leads t
    SET outreach_paused = false,
        customer_responded = false,
        campaign_started_at = plan.new_started_at,
        updated_at = NOW()
    FROM plan
    WHERE t.id = plan.id
      AND t.campaign_id = ${campaignId}
      AND COALESCE(t.outreach_count, 0) = plan.oc
      AND COALESCE(t.email_outreach_count, 0) = plan.ec
    RETURNING plan.id, plan.oc, plan.ec, plan.next_step,
              (plan.new_started_at + plan.next_day * INTERVAL '1 day') AS next_due_at
  `;
  return (rows[0] as ContinueResult) || null;
}

function describeContinue(r: ContinueResult | null): string {
  if (!r) return 'lead changed during assign; nothing updated';
  if (r.next_step == null) return 'no steps left on this campaign (already complete); nothing new will send';
  let when = '';
  if (r.next_due_at) {
    const due = new Date(r.next_due_at as string);
    if (due.getTime() <= Date.now()) {
      when = ' (due now: sends at the next sender cycle; quiet hours 9 PM-8 AM ET apply)';
    } else {
      const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York', weekday: 'short', month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit',
      });
      when = ` (due ${fmt.format(due)} ET)`;
    }
  }
  return `continuing at step ${r.next_step}${when}`;
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
      sender_name TEXT,
      sender_email TEXT,
      reply_to_email TEXT,
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
  await sql`ALTER TABLE crm_campaigns ADD COLUMN IF NOT EXISTS sender_name TEXT`;
  await sql`ALTER TABLE crm_campaigns ADD COLUMN IF NOT EXISTS sender_email TEXT`;
  await sql`ALTER TABLE crm_campaigns ADD COLUMN IF NOT EXISTS reply_to_email TEXT`;
  await sql`ALTER TABLE crm_campaigns ADD COLUMN IF NOT EXISTS crm_profile TEXT NOT NULL DEFAULT 'fencecrafters'`;
  await sql`ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS crm_profile TEXT NOT NULL DEFAULT 'fencecrafters'`;
  await sql`ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS campaign_id INTEGER REFERENCES crm_campaigns(id) ON DELETE SET NULL`;
  await sql`ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS campaign_started_at TIMESTAMPTZ`;
}

export async function GET(request: NextRequest) {
  if (!isAdmin(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureSchema();

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const includeLeads = searchParams.get('includeLeads') === '1';
  const countsOnly = searchParams.get('countsOnly') === '1';
  const includeNonresponders = searchParams.get('includeNonresponders') === '1';
  const profile = normalizeCrmProfile(searchParams.get('profile'));

  const campaigns = id
    ? await sql`
        SELECT c.*,
          COUNT(DISTINCT l.id)::int AS assigned_count,
          COUNT(DISTINCT l.id) FILTER (
            WHERE l.customer_responded = false
              AND l.outreach_paused = false
              AND COALESCE(l.status, 'new') <> 'lost'
          )::int AS active_assigned_count
        FROM crm_campaigns c
        LEFT JOIN crm_leads l ON l.campaign_id = c.id AND COALESCE(l.crm_profile, 'fencecrafters') = ${profile}
        WHERE c.id = ${Number(id)} AND COALESCE(c.crm_profile, 'fencecrafters') = ${profile}
        GROUP BY c.id
        ORDER BY c.created_at DESC
      `
    : await sql`
        SELECT c.*,
          COUNT(DISTINCT l.id)::int AS assigned_count,
          COUNT(DISTINCT l.id) FILTER (
            WHERE l.customer_responded = false
              AND l.outreach_paused = false
              AND COALESCE(l.status, 'new') <> 'lost'
          )::int AS active_assigned_count
        FROM crm_campaigns c
        LEFT JOIN crm_leads l ON l.campaign_id = c.id AND COALESCE(l.crm_profile, 'fencecrafters') = ${profile}
        WHERE COALESCE(c.crm_profile, 'fencecrafters') = ${profile}
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

  let leadCounts: Awaited<ReturnType<typeof sql>> = [];
  let leads: Awaited<ReturnType<typeof sql>> = [];
  if (includeLeads || countsOnly) {
    leadCounts = await sql`
      WITH default_angi_campaign AS (
        SELECT id, name
        FROM crm_campaigns
        WHERE source = 'angi' AND is_default = true AND is_active = true AND COALESCE(crm_profile, 'fencecrafters') = ${profile}
        ORDER BY id ASC
        LIMIT 1
      ), campaign_steps AS (
        SELECT
          campaign_id,
          COALESCE(COUNT(DISTINCT id) FILTER (WHERE channel IN ('sms', 'both') AND COALESCE(sms_body, '') <> ''), 0)::int AS sms_steps,
          COALESCE(COUNT(DISTINCT id) FILTER (WHERE channel IN ('email', 'both') AND COALESCE(email_body, sms_body, '') <> ''), 0)::int AS email_steps
        FROM crm_campaign_messages
        WHERE is_active = true
        GROUP BY campaign_id
      ), lead_base AS (
        SELECT
          l.*,
          CASE
            WHEN l.campaign_id IS NOT NULL THEN l.campaign_id
            WHEN l.source = 'angi' THEN (SELECT id FROM default_angi_campaign)
            ELSE NULL
          END AS effective_campaign_id
        FROM crm_leads l
        WHERE COALESCE(l.crm_profile, 'fencecrafters') = ${profile}
      ), enriched AS (
        SELECT
          l.id,
          l.status,
          l.customer_responded,
          l.outreach_paused,
          l.effective_campaign_id AS campaign_id,
          reply_after_start.last_customer_reply_at,
          (
            l.effective_campaign_id IS NOT NULL
            AND (
              (
                (COALESCE(steps.sms_steps, 0) > 0 OR COALESCE(steps.email_steps, 0) > 0)
                AND COALESCE(l.outreach_count, 0) >= COALESCE(steps.sms_steps, 0)
                AND COALESCE(l.email_outreach_count, 0) >= COALESCE(steps.email_steps, 0)
              )
              OR reply_after_start.last_customer_reply_at IS NOT NULL
              OR l.customer_responded IS TRUE
              OR COALESCE(l.status, '') IN ('lost', 'sold', 'won')
            )
          ) AS campaign_completed
        FROM lead_base l
        LEFT JOIN campaign_steps steps ON steps.campaign_id = l.effective_campaign_id
        LEFT JOIN LATERAL (
          SELECT MAX(a.created_at) AS last_customer_reply_at
          FROM crm_activity a
          WHERE a.crm_lead_id = l.id
            AND a.is_from_customer = true
            AND a.activity_type IN ('sms', 'email', 'customer_message')
            AND a.created_at >= COALESCE(l.campaign_started_at, l.created_at)
        ) reply_after_start ON true
      )
      SELECT
        SUM(status_count)::int AS total,
        jsonb_object_agg(status, status_count) AS by_status,
        jsonb_object_agg(status, active_campaign_count) AS active_campaign_by_status,
        jsonb_object_agg(status, campaign_completed_count) AS campaign_completed_by_status,
        jsonb_object_agg(status, no_campaign_count) AS no_campaign_by_status,
        SUM(active_campaign_count)::int AS active_campaign,
        SUM(campaign_completed_count)::int AS campaign_completed,
        SUM(no_campaign_count)::int AS no_campaign
      FROM (
        SELECT
          COALESCE(status, 'new') AS status,
          COUNT(*)::int AS status_count,
          COUNT(*) FILTER (WHERE campaign_id IS NOT NULL AND NOT campaign_completed AND outreach_paused = false)::int AS active_campaign_count,
          COUNT(*) FILTER (WHERE campaign_completed AND COALESCE(status, 'new') <> 'lost')::int AS campaign_completed_count,
          COUNT(*) FILTER (WHERE NOT campaign_completed AND campaign_id IS NULL)::int AS no_campaign_count
        FROM enriched
        GROUP BY COALESCE(status, 'new')
      ) grouped
    `;
    if (!countsOnly) {
    leads = await sql`
      WITH default_angi_campaign AS (
        SELECT id, name
        FROM crm_campaigns
        WHERE source = 'angi' AND is_default = true AND is_active = true AND COALESCE(crm_profile, 'fencecrafters') = ${profile}
        ORDER BY id ASC
        LIMIT 1
      ), campaign_steps AS (
        SELECT
          campaign_id,
          COALESCE(COUNT(DISTINCT id) FILTER (WHERE channel IN ('sms', 'both') AND COALESCE(sms_body, '') <> ''), 0)::int AS sms_steps,
          COALESCE(COUNT(DISTINCT id) FILTER (WHERE channel IN ('email', 'both') AND COALESCE(email_body, sms_body, '') <> ''), 0)::int AS email_steps
        FROM crm_campaign_messages
        WHERE is_active = true
        GROUP BY campaign_id
      ), lead_base AS (
        SELECT
          l.*,
          CASE
            WHEN l.campaign_id IS NOT NULL THEN l.campaign_id
            WHEN l.source = 'angi' THEN (SELECT id FROM default_angi_campaign)
            ELSE NULL
          END AS effective_campaign_id
        FROM crm_leads l
        WHERE COALESCE(l.crm_profile, 'fencecrafters') = ${profile}
      )
      SELECT
        l.id, l.lead_code, l.customer_name, l.customer_phone, l.customer_email, l.source, l.status,
        l.effective_campaign_id AS campaign_id, l.outreach_count, l.email_outreach_count, l.customer_responded, l.outreach_paused, l.created_at,
        camp.name AS campaign_name,
        reply_after_start.last_customer_reply_at AS campaign_customer_reply_at,
        COALESCE(steps.sms_steps, 0)::int AS campaign_sms_steps,
        COALESCE(steps.email_steps, 0)::int AS campaign_email_steps,
        (
          l.effective_campaign_id IS NOT NULL
          AND (
            (
              (COALESCE(steps.sms_steps, 0) > 0 OR COALESCE(steps.email_steps, 0) > 0)
              AND COALESCE(l.outreach_count, 0) >= COALESCE(steps.sms_steps, 0)
              AND COALESCE(l.email_outreach_count, 0) >= COALESCE(steps.email_steps, 0)
            )
            OR reply_after_start.last_customer_reply_at IS NOT NULL
            OR l.customer_responded IS TRUE
            OR COALESCE(l.status, '') IN ('lost', 'sold', 'won')
          )
        ) AS campaign_completed
      FROM lead_base l
      LEFT JOIN crm_campaigns camp ON camp.id = l.effective_campaign_id
      LEFT JOIN campaign_steps steps ON steps.campaign_id = l.effective_campaign_id
      LEFT JOIN LATERAL (
        SELECT MAX(a.created_at) AS last_customer_reply_at
        FROM crm_activity a
        WHERE a.crm_lead_id = l.id
          AND a.is_from_customer = true
          AND a.activity_type IN ('sms', 'email', 'customer_message')
          AND a.created_at >= COALESCE(l.campaign_started_at, l.created_at)
      ) reply_after_start ON true
      ORDER BY
        (l.campaign_id = ANY(${campaignIds})) DESC,
        campaign_completed DESC,
        l.created_at DESC
      LIMIT 1000
    `;
    }
  }

  let nonresponders: Awaited<ReturnType<typeof sql>> = [];
  if (includeNonresponders) {
    nonresponders = await sql`
      SELECT lead_id, lead_code, customer_name, customer_phone, customer_email, customer_city, service_type,
             source, status, created_at, last_outreach_at, outreach_count, email_outreach_count,
             customer_responded, outreach_paused, campaign_id, campaign_name, campaign_sms_steps,
             campaign_email_steps, final_send_day, days_since_last_outreach
      FROM crm_campaign_nonresponders nr
      WHERE campaign_id IS NOT NULL
        AND customer_responded = false
        AND outreach_paused = false
        AND outreach_count >= campaign_sms_steps
        AND COALESCE(email_outreach_count, 0) >= campaign_email_steps
        AND days_since_last_outreach >= 1
        AND EXISTS (SELECT 1 FROM crm_leads l WHERE l.id = nr.lead_id AND COALESCE(l.crm_profile, 'fencecrafters') = ${profile})
      ORDER BY last_outreach_at ASC NULLS LAST, created_at ASC
      LIMIT 1000
    `;
  }

  return NextResponse.json({ campaigns, messages, leads, leadCounts: leadCounts[0] || null, nonresponders });
}

export async function POST(request: NextRequest) {
  if (!isAdmin(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureSchema();
  const body = await request.json();
  const action = body.action;
  const profile = normalizeCrmProfile(body.crm_profile || request.nextUrl.searchParams.get('profile'));

  if (action === 'create_campaign') {
    const name = cleanText(body.name);
    if (!name) return NextResponse.json({ error: 'Campaign name required' }, { status: 400 });
    const rows = await sql`
      INSERT INTO crm_campaigns (name, description, source, is_active, is_default, sender_name, sender_email, reply_to_email, crm_profile)
      VALUES (${name}, ${cleanText(body.description)}, ${cleanText(body.source)}, ${body.is_active !== false}, ${body.is_default === true}, ${cleanText(body.sender_name)}, ${cleanText(body.sender_email)}, ${cleanText(body.reply_to_email)}, ${profile})
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
          is_active = ${body.is_active !== false}, is_default = ${body.is_default === true},
          sender_name = ${cleanText(body.sender_name)}, sender_email = ${cleanText(body.sender_email)},
          reply_to_email = ${cleanText(body.reply_to_email)}, updated_at = NOW()
      WHERE id = ${id} AND COALESCE(crm_profile, 'fencecrafters') = ${profile}
    `;
    if (body.is_default === true && cleanText(body.source)) {
      await sql`UPDATE crm_campaigns SET is_default = false WHERE id <> ${id} AND source = ${cleanText(body.source)} AND COALESCE(crm_profile, 'fencecrafters') = ${profile}`;
    }
    return NextResponse.json({ success: true });
  }

  if (action === 'upsert_message') {
    const campaignId = Number(body.campaign_id);
    const stepNumber = Number(body.step_number);
    if (!campaignId || !stepNumber) return NextResponse.json({ error: 'Campaign and step number required' }, { status: 400 });
    const campaignRows = await sql`SELECT id FROM crm_campaigns WHERE id = ${campaignId} AND COALESCE(crm_profile, 'fencecrafters') = ${profile} LIMIT 1`;
    if (!campaignRows.length) return NextResponse.json({ error: 'Campaign not found in this profile' }, { status: 404 });
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
    await sql`
      DELETE FROM crm_campaign_messages m
      USING crm_campaigns c
      WHERE m.id = ${Number(body.id)}
        AND c.id = m.campaign_id
        AND COALESCE(c.crm_profile, 'fencecrafters') = ${profile}
    `;
    return NextResponse.json({ success: true });
  }

  if (action === 'assign_lead') {
    try {
      const leadId = Number(body.lead_id);
      const campaignId = body.campaign_id ? Number(body.campaign_id) : null;
      if (!leadId) return NextResponse.json({ error: 'Lead id required' }, { status: 400 });
      const leadRows = await sql`SELECT id, campaign_id FROM crm_leads WHERE id = ${leadId} AND COALESCE(crm_profile, 'fencecrafters') = ${profile} LIMIT 1`;
      if (!leadRows.length) return NextResponse.json({ error: 'Lead not found in this profile' }, { status: 404 });
      const campaignRows = campaignId ? await sql`SELECT name, source FROM crm_campaigns WHERE id = ${campaignId} AND COALESCE(crm_profile, 'fencecrafters') = ${profile} LIMIT 1` : [];
      if (campaignId && !campaignRows.length) return NextResponse.json({ error: 'Campaign not found in this profile' }, { status: 404 });
      const campaign = campaignRows[0] || null;
      const campaignName = campaign?.name || null;
      const currentCampaignId = leadRows[0].campaign_id == null ? null : Number(leadRows[0].campaign_id);
      if (campaignId && currentCampaignId === campaignId) {
        // Same campaign: continue where it left off (Dan 2026-10-08). No counter reset.
        const cont = await continueSameCampaign(leadId, campaignId, profile);
        const contText = describeContinue(cont);
        await sql`
          INSERT INTO crm_activity (crm_lead_id, activity_type, description, is_from_customer, created_by)
          VALUES (${leadId}, 'status_change', ${`Reassigned to same campaign (${campaignName || `Campaign #${campaignId}`}) — ${contText}. Not restarted from step 1.`}, false, 'campaign_system')
        `;
        return NextResponse.json({ success: true, campaign_name: campaignName, continued: true, next_step: cont?.next_step ?? null });
      }
      const campaignStartAt = await nextCampaignStartExpression(campaignId, campaign);
      const description = campaignId ? `Assigned to campaign: ${campaignName || `Campaign #${campaignId}`}` : 'Campaign assignment removed';
      if (campaignId) {
        await sql`
          UPDATE crm_leads
          SET campaign_id = ${campaignId}, campaign_started_at = ${campaignStartAt},
              outreach_count = 0,
              email_outreach_count = 0,
              last_outreach_at = NULL,
              customer_responded = false,
              outreach_paused = false,
              updated_at = NOW()
          WHERE id = ${leadId} AND COALESCE(crm_profile, 'fencecrafters') = ${profile}
        `;
      } else {
        await sql`
          UPDATE crm_leads
          SET campaign_id = NULL, campaign_started_at = NULL,
              outreach_count = 0,
              email_outreach_count = 0,
              last_outreach_at = NULL,
              updated_at = NOW()
          WHERE id = ${leadId} AND COALESCE(crm_profile, 'fencecrafters') = ${profile}
        `;
      }
      await sql`
        INSERT INTO crm_activity (crm_lead_id, activity_type, description, is_from_customer, created_by)
        VALUES (${leadId}, 'status_change', ${description}, false, 'campaign_system')
      `;
      return NextResponse.json({ success: true, campaign_name: campaignName });
    } catch (error: any) {
      console.error('assign_lead failed', error);
      return NextResponse.json({ error: error?.message || 'Could not assign campaign' }, { status: 500 });
    }
  }

  if (action === 'bulk_assign') {
    const leadIds = Array.isArray(body.lead_ids) ? body.lead_ids.map(Number).filter(Boolean) : [];
    const campaignId = body.campaign_id ? Number(body.campaign_id) : null;
    if (!leadIds.length) return NextResponse.json({ error: 'No leads selected' }, { status: 400 });
    const campaignRows = campaignId ? await sql`SELECT name, source FROM crm_campaigns WHERE id = ${campaignId} AND COALESCE(crm_profile, 'fencecrafters') = ${profile} LIMIT 1` : [];
    if (campaignId && !campaignRows.length) return NextResponse.json({ error: 'Campaign not found in this profile' }, { status: 404 });
    const campaign = campaignRows[0] || null;
    const campaignName = campaign?.name || null;
    const campaignStartAt = await nextCampaignStartExpression(campaignId, campaign);
    // Same campaign: continue where it left off (Dan 2026-10-08); only the rest restart at step 1.
    let continuedCount = 0;
    if (campaignId) {
      const sameRows = await sql`
        SELECT id FROM crm_leads
        WHERE id = ANY(${leadIds}) AND campaign_id = ${campaignId} AND COALESCE(crm_profile, 'fencecrafters') = ${profile}
      `;
      for (const row of sameRows) {
        const leadId = Number(row.id);
        const cont = await continueSameCampaign(leadId, campaignId, profile);
        await sql`
          INSERT INTO crm_activity (crm_lead_id, activity_type, description, is_from_customer, created_by)
          VALUES (${leadId}, 'status_change', ${`Reassigned to same campaign (${campaignName || `Campaign #${campaignId}`}) — ${describeContinue(cont)}. Not restarted from step 1.`}, false, 'campaign_system')
        `;
        continuedCount += 1;
      }
    }
    const resetRows = await sql`
      UPDATE crm_leads
      SET campaign_id = ${campaignId}, campaign_started_at = ${campaignStartAt},
          outreach_count = 0,
          email_outreach_count = 0,
          last_outreach_at = NULL,
          customer_responded = CASE WHEN ${campaignId}::int IS NOT NULL THEN false ELSE customer_responded END,
          outreach_paused = CASE WHEN ${campaignId}::int IS NOT NULL THEN false ELSE outreach_paused END,
          updated_at = NOW()
      WHERE id = ANY(${leadIds}) AND COALESCE(crm_profile, 'fencecrafters') = ${profile}
        AND (${campaignId}::int IS NULL OR campaign_id IS DISTINCT FROM ${campaignId}::int)
      RETURNING id
    `;
    const resetIds = resetRows.map((r) => Number(r.id));
    if (resetIds.length) {
      await sql`
        INSERT INTO crm_activity (crm_lead_id, activity_type, description, is_from_customer, created_by)
        SELECT id, 'status_change', ${campaignId ? `Assigned to campaign: ${campaignName || `Campaign #${campaignId}`}` : 'Campaign assignment removed'}, false, 'campaign_system'
        FROM crm_leads
        WHERE id = ANY(${resetIds})
      `;
    }
    return NextResponse.json({ success: true, count: leadIds.length, campaign_name: campaignName, continued: continuedCount, restarted: resetIds.length });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
