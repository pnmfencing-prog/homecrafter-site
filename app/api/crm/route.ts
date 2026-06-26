import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { PNM_FENCING_EMAIL_SENDING_PAUSED, pnmFencingEmailPausedResponse } from '@/lib/email-policy';
import { normalizeText } from '@/lib/text';
import { assertSmsCapable, normalizeSmsPhone } from '@/lib/sms-guard';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const TWILIO_SID = process.env.TWILIO_SID || process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_TOKEN = process.env.TWILIO_TOKEN || process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_FROM = process.env.TWILIO_FROM || process.env.TWILIO_PHONE_NUMBER || '';

function normalizePhone(phone: string): string {
  return normalizeSmsPhone(phone);
}

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

function isAdmin(request: NextRequest): boolean {
  const auth = request.headers.get('authorization') || '';
  const token = auth.replace('Bearer ', '');
  return token === (process.env.ADMIN_TOKEN || 'hc-admin-2026');
}

async function enrichCampaignStatus(leads: any[]) {
  const leadIds = leads.map((lead) => lead.id).filter(Boolean);
  if (!leadIds.length) return leads;

  const rows = await sql`
    WITH default_angi_campaign AS (
      SELECT id, name, is_active
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
      WHERE l.id = ANY(${leadIds})
    )
    SELECT
      l.id AS lead_id,
      l.effective_campaign_id AS campaign_id,
      camp.name AS campaign_name,
      camp.is_active AS campaign_is_active,
      COALESCE(l.outreach_count, 0)::int AS campaign_sms_sent,
      COALESCE(l.email_outreach_count, 0)::int AS campaign_email_sent,
      COALESCE(MAX(m.step_number) FILTER (WHERE m.channel IN ('sms', 'both') AND COALESCE(m.sms_body, '') <> ''), 0)::int AS campaign_sms_steps,
      COALESCE(MAX(m.step_number) FILTER (WHERE m.channel IN ('email', 'both') AND COALESCE(m.email_body, m.sms_body, '') <> ''), 0)::int AS campaign_email_steps
    FROM lead_base l
    LEFT JOIN crm_campaigns camp ON camp.id = l.effective_campaign_id
    LEFT JOIN crm_campaign_messages m ON m.campaign_id = camp.id AND m.is_active = true
    GROUP BY l.id, l.effective_campaign_id, camp.name, camp.is_active, l.outreach_count, l.email_outreach_count
  `;
  const byLeadId = new Map(rows.map((row) => [row.lead_id, row]));
  return leads.map((lead) => {
    const row = byLeadId.get(lead.id) || {};
    const smsSent = Number(row.campaign_sms_sent || lead.outreach_count || 0);
    const emailSent = Number(row.campaign_email_sent || lead.email_outreach_count || 0);
    const smsSteps = Number(row.campaign_sms_steps || 0);
    const emailSteps = Number(row.campaign_email_steps || 0);
    const campaignId = row.campaign_id || lead.campaign_id || null;
    const hasCampaign = Boolean(campaignId);
    const hasSteps = smsSteps > 0 || emailSteps > 0;
    const campaignCompleted = hasCampaign && hasSteps && smsSent >= smsSteps && emailSent >= emailSteps;
    const campaignActiveNow = hasCampaign && row.campaign_is_active === true && !campaignCompleted && !lead.customer_responded && !lead.outreach_paused;
    return {
      ...lead,
      campaign_id: campaignId,
      campaign_name: row.campaign_name || null,
      campaign_is_active: row.campaign_is_active ?? null,
      campaign_sms_sent: smsSent,
      campaign_email_sent: emailSent,
      campaign_sms_steps: smsSteps,
      campaign_email_steps: emailSteps,
      campaign_completed: campaignCompleted,
      campaign_active_now: campaignActiveNow,
    };
  });
}

export async function GET(request: NextRequest) {
  if (!isAdmin(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const source = searchParams.get('source');
  const search = searchParams.get('search');
  const id = searchParams.get('id');
  const campaignFilter = searchParams.get('campaign');
  const readFilter = searchParams.get('read');
  const messageFilter = searchParams.get('message');
  const flaggedOnly = searchParams.get('flagged') === '1';
  const includeOptOuts = searchParams.get('include_optouts') === '1';
  const sinceFilter = searchParams.get('since') || '';
  const maxPerStatusParam = parseInt(searchParams.get('max_per_status') || '', 10);
  const maxPerStatus = Number.isFinite(maxPerStatusParam) && maxPerStatusParam > 0
    ? Math.min(maxPerStatusParam, 500)
    : null;
  const limitParam = parseInt(searchParams.get('limit') || '', 10);
  const resultLimit = Number.isFinite(limitParam) && limitParam > 0
    ? Math.min(limitParam, 5000)
    : null;
  const validSinceFilter = /^\d{4}-\d{2}-\d{2}$/.test(sinceFilter);
  const hasWorkflowRequest = !search && (
    readFilter === 'read' || readFilter === 'unread' ||
    messageFilter === 'you' || messageFilter === 'customer' ||
    campaignFilter === 'campaign_completed' || campaignFilter === 'no_campaign' || campaignFilter === 'no_active' ||
    flaggedOnly || validSinceFilter
  );

  // Single lead with activity
  if (id) {
    const leadId = parseInt(id);
    const leads = await sql`SELECT * FROM crm_leads WHERE id = ${leadId}`;
    if (leads.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const activeEvents = await sql`
      WITH active AS (
        SELECT *
        FROM calendar_events
        WHERE crm_lead_id = ${leadId}
          AND status IN ('scheduled', 'missed')
      ), ranked AS (
        SELECT
          active.*,
          COUNT(*) OVER (PARTITION BY crm_lead_id)::int AS active_calendar_event_count,
          ROW_NUMBER() OVER (
            PARTITION BY crm_lead_id
            ORDER BY
              (event_date < (NOW() AT TIME ZONE 'America/New_York')::date),
              CASE WHEN event_date >= (NOW() AT TIME ZONE 'America/New_York')::date THEN event_date END ASC,
              CASE WHEN event_date < (NOW() AT TIME ZONE 'America/New_York')::date THEN event_date END DESC,
              event_time ASC NULLS LAST,
              id ASC
          ) AS rn
        FROM active
      )
      SELECT
        crm_lead_id,
        id AS active_calendar_event_id,
        title AS active_calendar_event_title,
        event_date AS active_calendar_event_date,
        event_time AS active_calendar_event_time,
        event_type AS active_calendar_event_type,
        status AS active_calendar_event_status,
        active_calendar_event_count
      FROM ranked
      WHERE rn = 1
    `;
    const enrichedLead = (await enrichCampaignStatus([leads[0]]))[0];
    const previousCampaignRows = await sql`
      SELECT description, created_at
      FROM crm_activity
      WHERE crm_lead_id = ${leadId}
        AND activity_type = 'status_change'
        AND description ILIKE 'Assigned to campaign:%'
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const previousCampaignDescription = previousCampaignRows[0]?.description || '';
    const previousCampaignName = previousCampaignDescription.replace(/^Assigned to campaign:\s*/i, '').trim() || null;
    const lead = {
      ...enrichedLead,
      ...(activeEvents[0] || {}),
      previous_campaign_name: previousCampaignName,
      previous_campaign_assigned_at: previousCampaignRows[0]?.created_at || null,
    };
    const activity = await sql`SELECT * FROM crm_activity WHERE crm_lead_id = ${leadId} ORDER BY created_at DESC LIMIT 50`;
    const activityIds = activity.map((a) => a.id);
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
    const activityWithAttachments = activity.map((a) => ({ ...a, attachments: attachmentsByActivity.get(a.id) || [] }));
    const quotes = await sql`SELECT * FROM crm_quotes WHERE crm_lead_id = ${leadId} ORDER BY created_at DESC`;
    return NextResponse.json({ lead, activity: activityWithAttachments, quotes });
  }

  // Build filtered query using tagged templates.
  // Include latest SMS/email preview so customer cards show the message at a glance.
  let leads;
  if (hasWorkflowRequest) {
    const perStatusLimit = resultLimit || (validSinceFilter ? 250 : 100);
    leads = await sql`
      WITH latest_by_lead AS (
        SELECT DISTINCT ON (crm_lead_id)
          crm_lead_id,
          description,
          created_at,
          is_from_customer,
          created_by,
          activity_type
        FROM crm_activity
        WHERE activity_type IN ('sms', 'email')
        ORDER BY crm_lead_id, created_at DESC
      ), filtered AS (
        SELECT
          l.*,
          latest.description AS latest_message_preview,
          latest.created_at AS latest_message_at,
          latest.is_from_customer AS latest_message_from_customer,
          latest.created_by AS latest_message_created_by,
          latest.activity_type AS latest_message_type,
          COALESCE(latest.created_at, l.last_message_at, l.updated_at, l.created_at) AS workflow_activity_at
        FROM crm_leads l
        LEFT JOIN latest_by_lead latest ON latest.crm_lead_id = l.id
        LEFT JOIN LATERAL (
          SELECT CASE
            WHEN l.campaign_id IS NOT NULL THEN l.campaign_id
            WHEN l.source = 'angi' THEN (
              SELECT id FROM crm_campaigns
              WHERE source = 'angi' AND is_default = true AND is_active = true
              ORDER BY id ASC
              LIMIT 1
            )
            ELSE NULL
          END AS effective_campaign_id
        ) ec ON true
        LEFT JOIN LATERAL (
          SELECT
            COALESCE(MAX(step_number) FILTER (WHERE channel IN ('sms', 'both') AND COALESCE(sms_body, '') <> ''), 0)::int AS sms_steps,
            COALESCE(MAX(step_number) FILTER (WHERE channel IN ('email', 'both') AND COALESCE(email_body, sms_body, '') <> ''), 0)::int AS email_steps
          FROM crm_campaign_messages
          WHERE campaign_id = ec.effective_campaign_id
        ) cm ON true
        WHERE (${status || 'all'} = 'all' OR l.status = ${status || 'all'})
          AND (${source || 'all'} = 'all' OR l.source = ${source || 'all'})
          AND (${readFilter || 'all'} = 'all'
            OR (${readFilter || 'all'} = 'read' AND l.is_read IS TRUE)
            OR (${readFilter || 'all'} = 'unread' AND l.is_read IS NOT TRUE))
          AND (${messageFilter || 'all'} = 'all'
            OR (${messageFilter || 'all'} = 'you' AND l.last_message_by IN ('you', 'company'))
            OR (${messageFilter || 'all'} = 'customer' AND l.last_message_by = 'customer'))
          AND (${flaggedOnly} = false OR l.flagged IS TRUE)
          AND (${includeOptOuts} = true OR l.lost_reason IS DISTINCT FROM 'SMS opt-out (STOP/END)')
          AND (${validSinceFilter} = false OR COALESCE(latest.created_at, l.last_message_at, l.updated_at, l.created_at) >= (${sinceFilter || '1970-01-01'}::date AT TIME ZONE 'America/New_York'))
          AND (${campaignFilter || 'all'} = 'all'
            OR (${campaignFilter || 'all'} = 'campaign_completed'
              AND ec.effective_campaign_id IS NOT NULL
              AND (COALESCE(cm.sms_steps, 0) > 0 OR COALESCE(cm.email_steps, 0) > 0)
              AND COALESCE(l.outreach_count, 0) >= COALESCE(cm.sms_steps, 0)
              AND COALESCE(l.email_outreach_count, 0) >= COALESCE(cm.email_steps, 0))
            OR (${campaignFilter || 'all'} IN ('no_campaign', 'no_active') AND ec.effective_campaign_id IS NULL))
      ), ranked AS (
        SELECT *, ROW_NUMBER() OVER (
          PARTITION BY COALESCE(status, 'new')
          ORDER BY workflow_activity_at DESC, created_at DESC, id DESC
        ) AS status_rank
        FROM filtered
      )
      SELECT * FROM ranked
      WHERE status_rank <= ${perStatusLimit}
      ORDER BY workflow_activity_at DESC, created_at DESC, id DESC`;
  } else if (status && status !== 'all' && search) {
    const normalizedSearch = normalizeText(search).trim().replace(/\s+/g, ' ');
    const searchPat = `%${normalizedSearch}%`;
    leads = await sql`
      SELECT l.*, latest.description AS latest_message_preview, latest.created_at AS latest_message_at,
             latest.is_from_customer AS latest_message_from_customer, latest.created_by AS latest_message_created_by,
             latest.activity_type AS latest_message_type
      FROM crm_leads l
      LEFT JOIN LATERAL (
        SELECT description, created_at, is_from_customer, created_by, activity_type
        FROM crm_activity
        WHERE crm_lead_id = l.id AND activity_type IN ('sms', 'email')
        ORDER BY created_at DESC
        LIMIT 1
      ) latest ON true
      WHERE l.status = ${status} AND (
        l.customer_name ILIKE ${searchPat}
        OR l.customer_phone ILIKE ${searchPat}
        OR l.customer_email ILIKE ${searchPat}
        OR l.customer_address ILIKE ${searchPat}
        OR l.notes ILIKE ${searchPat}
        OR regexp_replace(COALESCE(l.notes, ''), '[[:space:]]+', ' ', 'g') ILIKE ${searchPat}
        OR EXISTS (
          SELECT 1 FROM crm_activity a
          WHERE a.crm_lead_id = l.id
            AND (
              a.description ILIKE ${searchPat}
              OR regexp_replace(replace(replace(COALESCE(a.description, ''), E'\\n', ' '), E'\\r', ' '), '[[:space:]]+', ' ', 'g') ILIKE ${searchPat}
            )
        )
      )
      ORDER BY l.created_at DESC`;
  } else if (status && status !== 'all') {
    leads = await sql`
      SELECT l.*, latest.description AS latest_message_preview, latest.created_at AS latest_message_at,
             latest.is_from_customer AS latest_message_from_customer, latest.created_by AS latest_message_created_by,
             latest.activity_type AS latest_message_type
      FROM crm_leads l
      LEFT JOIN LATERAL (
        SELECT description, created_at, is_from_customer, created_by, activity_type
        FROM crm_activity
        WHERE crm_lead_id = l.id AND activity_type IN ('sms', 'email')
        ORDER BY created_at DESC
        LIMIT 1
      ) latest ON true
      WHERE l.status = ${status}
      ORDER BY l.created_at DESC`;
  } else if (source && source !== 'all' && search) {
    const normalizedSearch = normalizeText(search).trim().replace(/\s+/g, ' ');
    const searchPat = `%${normalizedSearch}%`;
    leads = await sql`
      SELECT l.*, latest.description AS latest_message_preview, latest.created_at AS latest_message_at,
             latest.is_from_customer AS latest_message_from_customer, latest.created_by AS latest_message_created_by,
             latest.activity_type AS latest_message_type
      FROM crm_leads l
      LEFT JOIN LATERAL (
        SELECT description, created_at, is_from_customer, created_by, activity_type
        FROM crm_activity
        WHERE crm_lead_id = l.id AND activity_type IN ('sms', 'email')
        ORDER BY created_at DESC
        LIMIT 1
      ) latest ON true
      WHERE l.source = ${source} AND (
        l.customer_name ILIKE ${searchPat}
        OR l.customer_phone ILIKE ${searchPat}
        OR l.customer_email ILIKE ${searchPat}
        OR l.customer_address ILIKE ${searchPat}
        OR l.notes ILIKE ${searchPat}
        OR regexp_replace(COALESCE(l.notes, ''), '[[:space:]]+', ' ', 'g') ILIKE ${searchPat}
        OR EXISTS (
          SELECT 1 FROM crm_activity a
          WHERE a.crm_lead_id = l.id
            AND (
              a.description ILIKE ${searchPat}
              OR regexp_replace(replace(replace(COALESCE(a.description, ''), E'\\n', ' '), E'\\r', ' '), '[[:space:]]+', ' ', 'g') ILIKE ${searchPat}
            )
        )
      )
      ORDER BY l.created_at DESC`;
  } else if (source && source !== 'all') {
    leads = await sql`
      SELECT l.*, latest.description AS latest_message_preview, latest.created_at AS latest_message_at,
             latest.is_from_customer AS latest_message_from_customer, latest.created_by AS latest_message_created_by,
             latest.activity_type AS latest_message_type
      FROM crm_leads l
      LEFT JOIN LATERAL (
        SELECT description, created_at, is_from_customer, created_by, activity_type
        FROM crm_activity
        WHERE crm_lead_id = l.id AND activity_type IN ('sms', 'email')
        ORDER BY created_at DESC
        LIMIT 1
      ) latest ON true
      WHERE l.source = ${source}
      ORDER BY l.created_at DESC`;
  } else if (search) {
    const normalizedSearch = normalizeText(search).trim().replace(/\s+/g, ' ');
    const searchPat = `%${normalizedSearch}%`;
    leads = await sql`
      SELECT l.*, latest.description AS latest_message_preview, latest.created_at AS latest_message_at,
             latest.is_from_customer AS latest_message_from_customer, latest.created_by AS latest_message_created_by,
             latest.activity_type AS latest_message_type
      FROM crm_leads l
      LEFT JOIN LATERAL (
        SELECT description, created_at, is_from_customer, created_by, activity_type
        FROM crm_activity
        WHERE crm_lead_id = l.id AND activity_type IN ('sms', 'email')
        ORDER BY created_at DESC
        LIMIT 1
      ) latest ON true
      WHERE l.customer_name ILIKE ${searchPat}
        OR l.customer_phone ILIKE ${searchPat}
        OR l.customer_email ILIKE ${searchPat}
        OR l.customer_address ILIKE ${searchPat}
        OR l.notes ILIKE ${searchPat}
        OR regexp_replace(COALESCE(l.notes, ''), '[[:space:]]+', ' ', 'g') ILIKE ${searchPat}
        OR EXISTS (
          SELECT 1 FROM crm_activity a
          WHERE a.crm_lead_id = l.id
            AND (
              a.description ILIKE ${searchPat}
              OR regexp_replace(replace(replace(COALESCE(a.description, ''), E'\\n', ' '), E'\\r', ' '), '[[:space:]]+', ' ', 'g') ILIKE ${searchPat}
            )
        )
      ORDER BY l.created_at DESC`;
  } else if (messageFilter === 'you') {
    const workflowLimit = resultLimit || 250;
    leads = await sql`
      SELECT l.*, latest.description AS latest_message_preview, latest.created_at AS latest_message_at,
             latest.is_from_customer AS latest_message_from_customer, latest.created_by AS latest_message_created_by,
             latest.activity_type AS latest_message_type
      FROM crm_leads l
      LEFT JOIN LATERAL (
        SELECT description, created_at, is_from_customer, created_by, activity_type
        FROM crm_activity
        WHERE crm_lead_id = l.id AND activity_type IN ('sms', 'email')
        ORDER BY created_at DESC
        LIMIT 1
      ) latest ON true
      WHERE l.last_message_by IN ('you', 'company')
      ORDER BY COALESCE(latest.created_at, l.last_message_at, l.updated_at, l.created_at) DESC, l.created_at DESC, l.id DESC
      LIMIT ${workflowLimit}`;
  } else if (messageFilter === 'customer') {
    const workflowLimit = resultLimit || 250;
    leads = await sql`
      SELECT l.*, latest.description AS latest_message_preview, latest.created_at AS latest_message_at,
             latest.is_from_customer AS latest_message_from_customer, latest.created_by AS latest_message_created_by,
             latest.activity_type AS latest_message_type
      FROM crm_leads l
      LEFT JOIN LATERAL (
        SELECT description, created_at, is_from_customer, created_by, activity_type
        FROM crm_activity
        WHERE crm_lead_id = l.id AND activity_type IN ('sms', 'email')
        ORDER BY created_at DESC
        LIMIT 1
      ) latest ON true
      WHERE l.last_message_by = 'customer'
      ORDER BY COALESCE(latest.created_at, l.last_message_at, l.updated_at, l.created_at) DESC, l.created_at DESC, l.id DESC
      LIMIT ${workflowLimit}`;
  } else if (maxPerStatus) {
    leads = await sql`
      WITH latest_by_lead AS (
        SELECT DISTINCT ON (crm_lead_id)
          crm_lead_id,
          description,
          created_at,
          is_from_customer,
          created_by,
          activity_type
        FROM crm_activity
        WHERE activity_type IN ('sms', 'email')
        ORDER BY crm_lead_id, created_at DESC
      ), lead_rows AS (
        SELECT l.*, latest.description AS latest_message_preview, latest.created_at AS latest_message_at,
               latest.is_from_customer AS latest_message_from_customer, latest.created_by AS latest_message_created_by,
               latest.activity_type AS latest_message_type,
               ROW_NUMBER() OVER (
                 PARTITION BY COALESCE(l.status, 'new')
                 ORDER BY COALESCE(latest.created_at, l.last_message_at, l.updated_at, l.created_at) DESC, l.created_at DESC, l.id DESC
               ) AS status_rank
        FROM crm_leads l
        LEFT JOIN latest_by_lead latest ON latest.crm_lead_id = l.id
      )
      SELECT * FROM lead_rows
      WHERE status_rank <= ${maxPerStatus}
      ORDER BY created_at DESC`;
  } else {
    leads = await sql`
      SELECT l.*, latest.description AS latest_message_preview, latest.created_at AS latest_message_at,
             latest.is_from_customer AS latest_message_from_customer, latest.created_by AS latest_message_created_by,
             latest.activity_type AS latest_message_type
      FROM crm_leads l
      LEFT JOIN LATERAL (
        SELECT description, created_at, is_from_customer, created_by, activity_type
        FROM crm_activity
        WHERE crm_lead_id = l.id AND activity_type IN ('sms', 'email')
        ORDER BY created_at DESC
        LIMIT 1
      ) latest ON true
      ORDER BY COALESCE(latest.created_at, l.last_message_at, l.updated_at, l.created_at) DESC, l.created_at DESC, l.id DESC`;
  }

  if (readFilter === 'unread') {
    leads = leads.filter((lead) => lead.is_read !== true);
  } else if (readFilter === 'read') {
    leads = leads.filter((lead) => lead.is_read === true);
  }

  if (messageFilter === 'customer') {
    leads = leads.filter((lead) => lead.last_message_by === 'customer');
  } else if (messageFilter === 'you') {
    leads = leads.filter((lead) => lead.last_message_by === 'you' || lead.last_message_by === 'company');
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(sinceFilter)) {
    const sinceTime = new Date(`${sinceFilter}T00:00:00-04:00`).getTime();
    leads = leads.filter((lead) => {
      const value = lead.latest_message_at || lead.last_message_at || lead.updated_at || lead.created_at;
      const t = value ? new Date(value).getTime() : 0;
      return Number.isFinite(t) && t >= sinceTime;
    });
  }

  const workflowDefaultLimit = !resultLimit && !search && !hasWorkflowRequest && (messageFilter !== 'all' || readFilter !== 'all' || sinceFilter) ? (sinceFilter ? 1000 : 250) : null;
  // Workflow requests are already capped per status column in SQL. Do not apply
  // a second global slice here, or active columns later in the sort disappear.
  const effectiveResultLimit = hasWorkflowRequest ? null : (resultLimit || workflowDefaultLimit);
  if (effectiveResultLimit && leads.length > effectiveResultLimit) {
    leads = leads.slice(0, effectiveResultLimit);
  }

  leads = await enrichCampaignStatus(leads);
  if (!includeOptOuts && !search) {
    leads = leads.filter((lead) => lead.lost_reason !== 'SMS opt-out (STOP/END)');
  }
  if (flaggedOnly) {
    leads = leads.filter((lead) => lead.flagged === true);
  }

  if (campaignFilter === 'campaign_completed') {
    // Campaign filters cover the full lead lifecycle, matching the Campaigns page.
    leads = leads.filter((lead) => lead.campaign_completed);
  } else if (campaignFilter === 'no_campaign') {
    // Unassigned only. Completed campaign leads must not fall into this bucket.
    // Campaign filters cover the full lead lifecycle, matching the Campaigns page.
    leads = leads.filter((lead) => !lead.campaign_id && !lead.campaign_completed);
  } else if (campaignFilter === 'no_active') {
    // Backward compatibility for any old links/bookmarks.
    leads = leads.filter((lead) => !lead.campaign_id || lead.campaign_completed);
  }

  const leadIds = leads.map((lead) => lead.id);
  if (leadIds.length) {
    const activeEvents = await sql`
      WITH active AS (
        SELECT *
        FROM calendar_events
        WHERE crm_lead_id = ANY(${leadIds})
          AND status IN ('scheduled', 'missed')
      ), ranked AS (
        SELECT
          active.*,
          COUNT(*) OVER (PARTITION BY crm_lead_id)::int AS active_calendar_event_count,
          ROW_NUMBER() OVER (
            PARTITION BY crm_lead_id
            ORDER BY
              (event_date < (NOW() AT TIME ZONE 'America/New_York')::date),
              CASE WHEN event_date >= (NOW() AT TIME ZONE 'America/New_York')::date THEN event_date END ASC,
              CASE WHEN event_date < (NOW() AT TIME ZONE 'America/New_York')::date THEN event_date END DESC,
              event_time ASC NULLS LAST,
              id ASC
          ) AS rn
        FROM active
      )
      SELECT
        crm_lead_id,
        id AS active_calendar_event_id,
        title AS active_calendar_event_title,
        event_date AS active_calendar_event_date,
        event_time AS active_calendar_event_time,
        event_type AS active_calendar_event_type,
        status AS active_calendar_event_status,
        active_calendar_event_count
      FROM ranked
      WHERE rn = 1
    `;
    const eventByLeadId = new Map(activeEvents.map((event) => [event.crm_lead_id, event]));
    leads = leads.map((lead) => ({ ...lead, ...(eventByLeadId.get(lead.id) || {}) }));
  }

  const stats = await sql`
    SELECT 
      count(*) FILTER (WHERE status = 'new')::int as new_count,
      count(*) FILTER (WHERE status = 'promising_reply')::int as promising_reply_count,
      count(*) FILTER (WHERE status = 'neutral_reply')::int as neutral_reply_count,
      count(*) FILTER (WHERE status = 'real_estate_new')::int as real_estate_new_count,
      count(*) FILTER (WHERE status = 'real_estate_promising')::int as real_estate_promising_count,
      count(*) FILTER (WHERE status = 'real_estate_neutral')::int as real_estate_neutral_count,
      count(*) FILTER (WHERE status = 'contacted')::int as contacted_count,
      count(*) FILTER (WHERE status = 'quoted')::int as quoted_count,
      count(*) FILTER (WHERE status = 'scheduled')::int as scheduled_count,
      count(*) FILTER (WHERE status = 'won')::int as won_count,
      count(*) FILTER (WHERE status = 'sold')::int as sold_count,
      count(*) FILTER (WHERE status = 'lost')::int as lost_count,
      count(*)::int as total,
      coalesce(sum(job_value) FILTER (WHERE status IN ('won', 'sold')), 0)::numeric as total_revenue,
      coalesce(sum(quoted_amount) FILTER (WHERE status IN ('quoted','scheduled')), 0)::numeric as pipeline_value
    FROM crm_leads
  `;

  const exactStats = !search && (campaignFilter || 'all') === 'all'
    ? await sql`
        SELECT
          count(*) FILTER (WHERE status = 'new')::int as new_count,
          count(*) FILTER (WHERE status = 'promising_reply')::int as promising_reply_count,
          count(*) FILTER (WHERE status = 'neutral_reply')::int as neutral_reply_count,
          count(*) FILTER (WHERE status = 'real_estate_new')::int as real_estate_new_count,
          count(*) FILTER (WHERE status = 'real_estate_promising')::int as real_estate_promising_count,
          count(*) FILTER (WHERE status = 'real_estate_neutral')::int as real_estate_neutral_count,
          count(*) FILTER (WHERE status = 'contacted')::int as contacted_count,
          count(*) FILTER (WHERE status = 'quoted')::int as quoted_count,
          count(*) FILTER (WHERE status = 'scheduled')::int as scheduled_count,
          count(*) FILTER (WHERE status = 'won')::int as won_count,
          count(*) FILTER (WHERE status = 'sold')::int as sold_count,
          count(*) FILTER (WHERE status = 'lost')::int as lost_count,
          count(*)::int as total,
          coalesce(sum(job_value) FILTER (WHERE status IN ('won', 'sold')), 0)::numeric as total_revenue,
          coalesce(sum(quoted_amount) FILTER (WHERE status IN ('quoted','scheduled')), 0)::numeric as pipeline_value
        FROM crm_leads
        WHERE (${status || 'all'} = 'all' OR status = ${status || 'all'})
          AND (${source || 'all'} = 'all' OR source = ${source || 'all'})
          AND (${readFilter || 'all'} = 'all' OR (${readFilter || 'all'} = 'unread' AND is_read IS NOT TRUE) OR (${readFilter || 'all'} = 'read' AND is_read IS TRUE))
          AND (${messageFilter || 'all'} = 'all' OR (${messageFilter || 'all'} = 'you' AND last_message_by IN ('you', 'company')) OR (${messageFilter || 'all'} = 'customer' AND last_message_by = 'customer'))
          AND (${flaggedOnly} = false OR flagged IS TRUE)
          AND (${includeOptOuts} = true OR lost_reason IS DISTINCT FROM 'SMS opt-out (STOP/END)')
          AND (${validSinceFilter} = false OR COALESCE(last_message_at, updated_at, created_at) >= (${sinceFilter || '1970-01-01'}::date AT TIME ZONE 'America/New_York'))
      `
    : [];

  return NextResponse.json({ leads, stats: stats[0], exactStats: exactStats[0] || null });
}

export async function POST(request: NextRequest) {
  if (!isAdmin(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { action } = body;

  if (action === 'find_or_create') {
    const name = (body.customer_name || '').trim();
    if (!name) return NextResponse.json({ error: 'Name required' }, { status: 400 });
    
    // Check if lead exists by exact name match
    const existing = await sql`SELECT * FROM crm_leads WHERE LOWER(customer_name) = LOWER(${name}) LIMIT 1`;
    if (existing.length) {
      // Update phone/email if provided and missing
      if (body.customer_phone && !existing[0].customer_phone) {
        await sql`UPDATE crm_leads SET customer_phone = ${body.customer_phone}, updated_at = NOW() WHERE id = ${existing[0].id}`;
      }
      if (body.customer_email && !existing[0].customer_email) {
        await sql`UPDATE crm_leads SET customer_email = ${body.customer_email}, updated_at = NOW() WHERE id = ${existing[0].id}`;
      }
      return NextResponse.json({ success: true, lead: existing[0], created: false });
    }
    
    // Create new lead with auto-assigned code
    const maxCode = await sql`SELECT COALESCE(MAX(CAST(lead_code AS INTEGER)), 99) + 1 as next_code FROM crm_leads WHERE lead_code ~ '^[0-9]+$'`;
    const leadCode = String(maxCode[0].next_code);
    const chatToken = [...Array(16)].map(() => Math.random().toString(36)[2]).join('');
    const result = await sql`
      INSERT INTO crm_leads (customer_name, customer_phone, customer_email, source, status, chat_token, lead_code)
      VALUES (${name}, ${body.customer_phone || null}, ${body.customer_email || null}, ${body.source || 'direct'}, 'new', ${chatToken}, ${leadCode})
      RETURNING *
    `;
    await sql`INSERT INTO crm_activity (crm_lead_id, activity_type, description) VALUES (${result[0].id}, 'status_change', 'Lead created from calendar')`;
    return NextResponse.json({ success: true, lead: result[0], created: true });
  }

  if (action === 'create') {
    const chatToken = [...Array(16)].map(() => Math.random().toString(36)[2]).join('');
    // Auto-assign lead code
    const maxCode = await sql`SELECT COALESCE(MAX(CAST(lead_code AS INTEGER)), 99) + 1 as next_code FROM crm_leads WHERE lead_code ~ '^[0-9]+$'`;
    const leadCode = String(maxCode[0].next_code);
    const result = await sql`
      INSERT INTO crm_leads (customer_name, customer_phone, customer_email, customer_address, customer_city, customer_state, customer_zip, service_type, notes, source, chat_token, lead_code)
      VALUES (${body.customer_name || null}, ${body.customer_phone || null}, ${body.customer_email || null}, ${body.customer_address || null}, ${body.customer_city || null}, ${body.customer_state || null}, ${body.customer_zip || null}, ${body.service_type || null}, ${body.notes || null}, ${body.source || 'manual'}, ${chatToken}, ${leadCode})
      RETURNING *
    `;
    await sql`INSERT INTO crm_activity (crm_lead_id, activity_type, description) VALUES (${result[0].id}, 'status_change', 'Lead created')`;
    return NextResponse.json({ success: true, lead: result[0] });
  }

  if (action === 'toggle_flag') {
    const { id, flagged } = body;
    const rows = await sql`
      UPDATE crm_leads
      SET flagged = ${Boolean(flagged)}, updated_at = NOW()
      WHERE id = ${id}
      RETURNING id, flagged
    `;
    await sql`
      INSERT INTO crm_activity (crm_lead_id, activity_type, description, is_from_customer, created_by)
      VALUES (${id}, 'note', ${Boolean(flagged) ? '🚩 Project flagged' : 'Project unflagged'}, false, 'admin')
    `;
    return NextResponse.json({ success: true, lead: rows[0] });
  }

  if (action === 'update_status') {
    const { id, status, lost_reason } = body;
    await sql`UPDATE crm_leads SET status = ${status}, updated_at = NOW() WHERE id = ${id}`;

    if (status === 'contacted') await sql`UPDATE crm_leads SET contacted_at = NOW() WHERE id = ${id}`;
    if (status === 'quoted') await sql`UPDATE crm_leads SET quoted_at = NOW() WHERE id = ${id}`;
    if (status === 'scheduled') await sql`UPDATE crm_leads SET scheduled_at = NOW() WHERE id = ${id}`;
    if (status === 'won') await sql`UPDATE crm_leads SET completed_at = NOW() WHERE id = ${id}`;
    if (status === 'lost') {
      await sql`UPDATE crm_leads SET closed_at = NOW() WHERE id = ${id}`;
      if (lost_reason) await sql`UPDATE crm_leads SET lost_reason = ${lost_reason} WHERE id = ${id}`;
    }

    const desc = 'Status changed to ' + status;
    await sql`INSERT INTO crm_activity (crm_lead_id, activity_type, description) VALUES (${id}, 'status_change', ${desc})`;
    return NextResponse.json({ success: true });
  }

  if (action === 'update') {
    const { id, quoted_amount, job_value, assigned_to, next_follow_up, notes, service_type, customer_email, customer_phone, customer_name, customer_address, customer_city, customer_state, customer_zip } = body;
    if (quoted_amount !== undefined) await sql`UPDATE crm_leads SET quoted_amount = ${quoted_amount}, updated_at = NOW() WHERE id = ${id}`;
    if (job_value !== undefined) await sql`UPDATE crm_leads SET job_value = ${job_value}, updated_at = NOW() WHERE id = ${id}`;
    if (assigned_to !== undefined) await sql`UPDATE crm_leads SET assigned_to = ${assigned_to}, updated_at = NOW() WHERE id = ${id}`;
    if (next_follow_up !== undefined) await sql`UPDATE crm_leads SET next_follow_up = ${next_follow_up}, updated_at = NOW() WHERE id = ${id}`;
    if (notes !== undefined) {
      await sql`UPDATE crm_leads SET notes = ${notes}, updated_at = NOW() WHERE id = ${id}`;
      await sql`UPDATE calendar_events SET description = ${notes || null}, updated_at = NOW() WHERE crm_lead_id = ${id}`;
    }
    if (service_type !== undefined) await sql`UPDATE crm_leads SET service_type = ${service_type}, updated_at = NOW() WHERE id = ${id}`;
    if (customer_email !== undefined) await sql`UPDATE crm_leads SET customer_email = ${customer_email}, updated_at = NOW() WHERE id = ${id}`;
    if (customer_phone !== undefined) await sql`UPDATE crm_leads SET customer_phone = ${customer_phone}, updated_at = NOW() WHERE id = ${id}`;
    if (customer_name !== undefined) await sql`UPDATE crm_leads SET customer_name = ${customer_name}, updated_at = NOW() WHERE id = ${id}`;
    if (customer_address !== undefined) await sql`UPDATE crm_leads SET customer_address = ${customer_address}, updated_at = NOW() WHERE id = ${id}`;
    if (customer_city !== undefined) await sql`UPDATE crm_leads SET customer_city = ${customer_city}, updated_at = NOW() WHERE id = ${id}`;
    if (customer_state !== undefined) await sql`UPDATE crm_leads SET customer_state = ${customer_state}, updated_at = NOW() WHERE id = ${id}`;
    if (customer_zip !== undefined) await sql`UPDATE crm_leads SET customer_zip = ${customer_zip}, updated_at = NOW() WHERE id = ${id}`;
    return NextResponse.json({ success: true });
  }

  if (action === 'add_note') {
    const { id, activity_type, subject } = body;
    const description = normalizeText(body.description || '');
    const attachments = Array.isArray(body.attachments) ? body.attachments : [];
    const isFromCustomer = description?.startsWith('📥') || false;

    if (activity_type === 'email' && !isFromCustomer && PNM_FENCING_EMAIL_SENDING_PAUSED) {
      return NextResponse.json(pnmFencingEmailPausedResponse(), { status: 423 });
    }

    if (activity_type === 'sms' && !isFromCustomer) {
      const leads = await sql`SELECT customer_phone FROM crm_leads WHERE id = ${id} LIMIT 1`;
      const to = leads[0]?.customer_phone;
      const smsBody = normalizeText(description || '').replace(/^(📤|📥)\s*/, '');
      if (!to) return NextResponse.json({ error: 'Customer phone is missing' }, { status: 400 });
      if (!smsBody) return NextResponse.json({ error: 'SMS body is missing' }, { status: 400 });
      try {
        await sendTwilioSms(to, smsBody);
      } catch (err: any) {
        return NextResponse.json({ error: err?.message || 'SMS send failed' }, { status: 502 });
      }
    }

    const inserted = await sql`INSERT INTO crm_activity (crm_lead_id, activity_type, description, is_from_customer) VALUES (${id}, ${activity_type || 'note'}, ${description}, ${isFromCustomer}) RETURNING id`;
    const activityId = inserted[0].id;
    for (const att of attachments.slice(0, 5)) {
      const fileName = String(att.name || 'attachment').slice(0, 180);
      const mimeType = String(att.mimeType || 'application/octet-stream').slice(0, 120);
      const dataBase64 = String(att.dataBase64 || '').replace(/^data:[^;]+;base64,/, '');
      if (!dataBase64) continue;
      const sizeBytes = Math.floor((dataBase64.length * 3) / 4);
      await sql`
        INSERT INTO crm_attachments (crm_activity_id, crm_lead_id, file_name, mime_type, content_base64, size_bytes, direction)
        VALUES (${activityId}, ${id}, ${fileName}, ${mimeType}, ${dataBase64}, ${sizeBytes}, ${isFromCustomer ? 'inbound' : 'outbound'})
      `;
    }
    const sender = isFromCustomer ? 'customer' : 'you';
    await sql`UPDATE crm_leads SET updated_at = NOW(), last_message_by = ${sender}, last_message_at = NOW(), is_read = ${!isFromCustomer} WHERE id = ${id}`;

    if (activity_type === 'email' && !isFromCustomer) {
      const leads = await sql`SELECT customer_name, customer_email FROM crm_leads WHERE id = ${id} LIMIT 1`;
      const to = leads[0]?.customer_email;
      const cleanSubject = (subject || 'Following up from PNM Fencing').trim();
      const bodyText = normalizeText(description || '').replace(/^(📤|📥)\s*/, '').replace(/^Subject:\s*[^\n]+\n\n/, '');
      if (to && process.env.BREVO_API_KEY) {
        const res = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sender: { name: 'PNM Fencing', email: 'trent@homecrafter.ai' },
            to: [{ email: to, name: leads[0]?.customer_name || undefined }],
            subject: cleanSubject,
            textContent: bodyText,
            htmlContent: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;white-space:pre-wrap">${bodyText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`,
            attachment: attachments.slice(0, 5).map((att: any) => ({
              name: String(att.name || 'attachment').slice(0, 180),
              content: String(att.dataBase64 || '').replace(/^data:[^;]+;base64,/, ''),
            })).filter((att: any) => att.content),
          }),
        });
        if (!res.ok) return NextResponse.json({ error: `Email send failed: ${await res.text()}` }, { status: 502 });
      }
    }

    return NextResponse.json({ success: true });
  }

  if (action === 'toggle_read') {
    const { id, is_read } = body;
    await sql`UPDATE crm_leads SET is_read = ${is_read} WHERE id = ${id}`;
    return NextResponse.json({ success: true });
  }

  if (action === 'delete') {
    await sql`DELETE FROM crm_leads WHERE id = ${body.id}`;
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
