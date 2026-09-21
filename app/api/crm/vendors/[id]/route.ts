import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { isCrmAdmin } from '@/lib/crm-admin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const PROFILE_TYPES = new Set(['material_supplier', 'junk_sub', 'installer']);
const CRM_PROFILES = new Set(['fencecrafters', 'pnm_fencing', 'lowes_fencing']);
const STATUSES = new Set(['active', 'inactive', 'archived']);

function normalizeCrmProfile(raw: unknown): string | null {
  const profileRaw = String(raw || '').trim();
  if (!profileRaw) return null;
  if (profileRaw === 'pnm_fencing' || profileRaw === 'lowes_fencing') return profileRaw;
  if (profileRaw === 'fencecrafters') return 'fencecrafters';
  return 'fencecrafters';
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  if (!isCrmAdmin(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await context.params;
  const rows = await sql`
    SELECT
      v.*,
      COALESCE(SUM(t.unread_count), 0)::int AS unread_count,
      MAX(t.last_message_at) AS last_message_at
    FROM crm_vendor_profiles v
    LEFT JOIN crm_comm_threads t ON t.vendor_id = v.id
    WHERE v.id = ${id}::uuid
    GROUP BY v.id
    LIMIT 1
  `;

  if (!rows.length) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const row: any = rows[0];
  return NextResponse.json({
    vendor: {
      ...row,
      phone: row.primary_phone,
      email: row.primary_email,
      last_activity_at: row.last_activity_at || row.last_message_at || null,
    },
  });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  if (!isCrmAdmin(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await context.params;
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const existing = await sql`SELECT * FROM crm_vendor_profiles WHERE id = ${id}::uuid LIMIT 1`;
  if (!existing.length) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const cur: any = existing[0];

  const profileType = body.profile_type != null ? String(body.profile_type).trim() : cur.profile_type;
  const displayName = body.display_name != null || body.name != null
    ? String(body.display_name || body.name || '').trim()
    : cur.display_name;
  const company = body.company !== undefined ? (String(body.company || '').trim() || null) : cur.company;
  const primaryPhone = body.primary_phone !== undefined || body.phone !== undefined
    ? (String(body.primary_phone || body.phone || '').trim() || null)
    : cur.primary_phone;
  const primaryEmail = body.primary_email !== undefined || body.email !== undefined
    ? (String(body.primary_email || body.email || '').trim() || null)
    : cur.primary_email;
  const website = body.website !== undefined ? (String(body.website || '').trim() || null) : cur.website;
  const notes = body.notes !== undefined ? (String(body.notes || '').trim() || null) : cur.notes;
  const status = body.status != null ? String(body.status).trim() : cur.status;
  const crmProfile = body.crm_profile !== undefined || body.profile !== undefined
    ? (normalizeCrmProfile(body.crm_profile || body.profile) || cur.crm_profile)
    : cur.crm_profile;

  if (!PROFILE_TYPES.has(profileType)) {
    return NextResponse.json({
      error: 'profile_type must be material_supplier, junk_sub, or installer',
    }, { status: 400 });
  }
  if (!displayName) {
    return NextResponse.json({ error: 'display_name is required' }, { status: 400 });
  }
  if (!CRM_PROFILES.has(crmProfile)) {
    return NextResponse.json({ error: 'Invalid crm_profile' }, { status: 400 });
  }
  if (!STATUSES.has(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }

  const rows = await sql`
    UPDATE crm_vendor_profiles
    SET
      profile_type = ${profileType},
      crm_profile = ${crmProfile},
      display_name = ${displayName},
      company = ${company},
      primary_phone = ${primaryPhone},
      primary_email = ${primaryEmail},
      website = ${website},
      status = ${status},
      notes = ${notes},
      updated_at = NOW()
    WHERE id = ${id}::uuid
    RETURNING *
  `;

  const row: any = rows[0];
  return NextResponse.json({
    vendor: {
      ...row,
      phone: row.primary_phone,
      email: row.primary_email,
      last_activity_at: row.last_activity_at || null,
    },
  });
}
