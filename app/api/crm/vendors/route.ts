import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { isCrmAdmin } from '@/lib/crm-admin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function mapVendor(row: any) {
  return {
    ...row,
    phone: row.primary_phone,
    email: row.primary_email,
    last_activity_at: row.last_activity_at || row.last_message_at || null,
    recent_messages: Array.isArray(row.recent_messages) ? row.recent_messages : [],
  };
}

function mapRecentMessage(row: any) {
  const actorType = String(row.actor_type || "");
  const direction = String(row.direction || "");
  const isFromVendor =
    actorType === "vendor" ||
    (direction === "inbound" && actorType !== "staff");
  return {
    id: row.id,
    vendor_id: row.vendor_id,
    actor_type: row.actor_type,
    actor_label: row.actor_label,
    body_text: row.body_text,
    created_at: row.created_at,
    direction: row.direction,
    message_kind: row.message_kind,
    is_from_vendor: isFromVendor,
    // CRM tile equivalent: counterparty bubble (vendor ≈ customer)
    is_from_customer: isFromVendor,
  };
}

async function attachRecentMessages(rows: any[]) {
  const vendorIds = rows.map((r) => r.id).filter(Boolean);
  if (!vendorIds.length) return rows.map((r) => ({ ...r, recent_messages: [] }));

  const recentMessages = await sql`
    WITH vendor_ids AS (
      SELECT unnest(${vendorIds}::uuid[]) AS vendor_id
    )
    SELECT
      recent.vendor_id,
      recent.id,
      recent.actor_type,
      recent.actor_label,
      recent.body_text,
      recent.created_at,
      recent.direction,
      recent.message_kind
    FROM vendor_ids vi
    CROSS JOIN LATERAL (
      SELECT
        t.vendor_id,
        m.id,
        m.actor_type,
        m.actor_label,
        LEFT(COALESCE(m.body_text, ''), 500) AS body_text,
        m.created_at,
        m.direction,
        m.message_kind
      FROM crm_comm_threads t
      INNER JOIN crm_comm_messages m ON m.thread_id = t.id
      WHERE t.vendor_id = vi.vendor_id
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT 8
    ) recent
    ORDER BY recent.vendor_id, recent.created_at ASC, recent.id ASC
  `;

  const messagesByVendorId = new Map<string, any[]>();
  for (const msg of recentMessages) {
    const key = String(msg.vendor_id);
    const list = messagesByVendorId.get(key) || [];
    list.push(mapRecentMessage(msg));
    messagesByVendorId.set(key, list);
  }

  return rows.map((r) => ({
    ...r,
    recent_messages: messagesByVendorId.get(String(r.id)) || [],
  }));
}

export async function GET(request: NextRequest) {
  if (!isCrmAdmin(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const type = (searchParams.get('type') || '').trim();
  const q = (searchParams.get('q') || '').trim();
  const like = q ? `%${q}%` : null;
  const profileRaw = (searchParams.get('profile') || searchParams.get('crm_profile') || '').trim();
  const crmProfile = profileRaw === 'pnm_fencing' || profileRaw === 'lowes_fencing' ? profileRaw : (profileRaw ? 'fencecrafters' : null);

  let rows;
  if (type && like) {
    rows = await sql`
      SELECT
        v.id, v.profile_type, v.crm_profile, v.display_name, v.company, v.primary_phone, v.primary_email,
        v.website, v.status, v.notes, v.last_activity_at, v.created_at, v.updated_at,
        COALESCE(SUM(t.unread_count), 0)::int AS unread_count,
        MAX(t.last_message_at) AS last_message_at
      FROM crm_vendor_profiles v
      LEFT JOIN crm_comm_threads t ON t.vendor_id = v.id
      WHERE v.profile_type = ${type}
        AND (${crmProfile}::text IS NULL OR v.crm_profile = ${crmProfile})
        AND (
          v.display_name ILIKE ${like}
          OR COALESCE(v.company, '') ILIKE ${like}
          OR COALESCE(v.primary_phone, '') ILIKE ${like}
          OR COALESCE(v.primary_email, '') ILIKE ${like}
        )
      GROUP BY v.id
      ORDER BY COALESCE(MAX(t.last_message_at), v.last_activity_at, v.updated_at, v.created_at) DESC, v.display_name ASC
    `;
  } else if (type) {
    rows = await sql`
      SELECT
        v.id, v.profile_type, v.crm_profile, v.display_name, v.company, v.primary_phone, v.primary_email,
        v.website, v.status, v.notes, v.last_activity_at, v.created_at, v.updated_at,
        COALESCE(SUM(t.unread_count), 0)::int AS unread_count,
        MAX(t.last_message_at) AS last_message_at
      FROM crm_vendor_profiles v
      LEFT JOIN crm_comm_threads t ON t.vendor_id = v.id
      WHERE v.profile_type = ${type}
        AND (${crmProfile}::text IS NULL OR v.crm_profile = ${crmProfile})
      GROUP BY v.id
      ORDER BY COALESCE(MAX(t.last_message_at), v.last_activity_at, v.updated_at, v.created_at) DESC, v.display_name ASC
    `;
  } else if (like) {
    rows = await sql`
      SELECT
        v.id, v.profile_type, v.crm_profile, v.display_name, v.company, v.primary_phone, v.primary_email,
        v.website, v.status, v.notes, v.last_activity_at, v.created_at, v.updated_at,
        COALESCE(SUM(t.unread_count), 0)::int AS unread_count,
        MAX(t.last_message_at) AS last_message_at
      FROM crm_vendor_profiles v
      LEFT JOIN crm_comm_threads t ON t.vendor_id = v.id
      WHERE (${crmProfile}::text IS NULL OR v.crm_profile = ${crmProfile})
        AND (
        v.display_name ILIKE ${like}
        OR COALESCE(v.company, '') ILIKE ${like}
        OR COALESCE(v.primary_phone, '') ILIKE ${like}
        OR COALESCE(v.primary_email, '') ILIKE ${like}
      )
      GROUP BY v.id
      ORDER BY COALESCE(MAX(t.last_message_at), v.last_activity_at, v.updated_at, v.created_at) DESC, v.display_name ASC
    `;
  } else {
    rows = await sql`
      SELECT
        v.id, v.profile_type, v.crm_profile, v.display_name, v.company, v.primary_phone, v.primary_email,
        v.website, v.status, v.notes, v.last_activity_at, v.created_at, v.updated_at,
        COALESCE(SUM(t.unread_count), 0)::int AS unread_count,
        MAX(t.last_message_at) AS last_message_at
      FROM crm_vendor_profiles v
      LEFT JOIN crm_comm_threads t ON t.vendor_id = v.id
      WHERE (${crmProfile}::text IS NULL OR v.crm_profile = ${crmProfile})
      GROUP BY v.id
      ORDER BY COALESCE(MAX(t.last_message_at), v.last_activity_at, v.updated_at, v.created_at) DESC, v.display_name ASC
    `;
  }

  const withMessages = await attachRecentMessages(rows as any[]);
  return NextResponse.json({ vendors: withMessages.map(mapVendor) });
}

