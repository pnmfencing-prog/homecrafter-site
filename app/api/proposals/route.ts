import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { normalizeText } from '@/lib/text';

function isAdmin(request: NextRequest): boolean {
  const auth = request.headers.get('authorization') || '';
  const token = auth.replace('Bearer ', '');
  return token === (process.env.ADMIN_TOKEN || 'hc-admin-2026');
}

export async function GET(request: NextRequest) {
  if (!isAdmin(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const status = searchParams.get('status');

  if (id) {
    const proposals = await sql`
      SELECT p.*, cl.customer_name as lead_name, cl.customer_phone as lead_phone
      FROM proposals p
      LEFT JOIN crm_leads cl ON p.crm_lead_id = cl.id
      WHERE p.id = ${parseInt(id)}
    `;
    if (!proposals.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ proposal: proposals[0] });
  }

  let proposals;
  if (status && status !== 'all') {
    proposals = await sql`
      SELECT p.*, cl.customer_name as lead_name, cl.customer_phone as lead_phone
      FROM proposals p
      LEFT JOIN crm_leads cl ON p.crm_lead_id = cl.id
      WHERE p.status = ${status}
      ORDER BY p.created_at DESC
    `;
  } else {
    proposals = await sql`
      SELECT p.*, cl.customer_name as lead_name, cl.customer_phone as lead_phone
      FROM proposals p
      LEFT JOIN crm_leads cl ON p.crm_lead_id = cl.id
      ORDER BY p.created_at DESC
    `;
  }

  const stats = await sql`
    SELECT 
      count(*)::int as total,
      count(*) FILTER (WHERE status = 'draft')::int as draft_count,
      count(*) FILTER (WHERE status = 'sent')::int as sent_count,
      count(*) FILTER (WHERE status = 'opened')::int as opened_count,
      count(*) FILTER (WHERE status = 'signed')::int as signed_count,
      count(*) FILTER (WHERE status = 'cancelled')::int as cancelled_count,
      coalesce(sum(total) FILTER (WHERE status = 'signed'), 0)::numeric as signed_value,
      coalesce(sum(total) FILTER (WHERE status = 'sent'), 0)::numeric as pending_value
    FROM proposals
  `;

  return NextResponse.json({ proposals, stats: stats[0] });
}

export async function POST(request: NextRequest) {
  if (!isAdmin(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { action } = body;

  if (action === 'create') {
    // Get next estimate number
    const maxEst = await sql`SELECT COALESCE(MAX(CAST(estimate_no AS INTEGER)), 1191) + 1 as next_no FROM proposals`;
    const estNo = body.estimate_no || String(maxEst[0].next_no);

    const result = await sql`
      INSERT INTO proposals (estimate_no, crm_lead_id, client_name, client_email, client_phone, client_address, client_city, client_state, client_zip,
        footage, height, color, material, gate_count, panels, extra_posts, removal_type, removal_footage,
        total, deposit, installment_2, installment_3, spot_holding_fee, status, pdf_filename, notes, description_override)
      VALUES (${estNo}, ${body.crm_lead_id || null}, ${body.client_name || null}, ${body.client_email || null}, ${body.client_phone || null},
        ${body.client_address || null}, ${body.client_city || null}, ${body.client_state || null}, ${body.client_zip || null},
        ${body.footage || null}, ${body.height || '6ft'}, ${body.color || 'White'}, ${body.material || 'vinyl'},
        ${body.gate_count || 0}, ${body.panels || null}, ${body.extra_posts || 2},
        ${body.removal_type || null}, ${body.removal_footage || 0},
        ${body.total || null}, ${body.deposit || null}, ${body.installment_2 || null}, ${body.installment_3 || null},
        ${body.spot_holding_fee || 150}, ${body.status || 'draft'}, ${body.pdf_filename || null},
        ${body.notes ? normalizeText(body.notes) : null}, ${body.description_override ? normalizeText(body.description_override) : null})
      RETURNING *
    `;
    return NextResponse.json({ success: true, proposal: result[0] });
  }

  if (action === 'update') {
    const id = body.id;
    const f = body;
    if (f.client_name !== undefined) await sql`UPDATE proposals SET client_name = ${f.client_name}, updated_at = NOW() WHERE id = ${id}`;
    if (f.client_phone !== undefined) await sql`UPDATE proposals SET client_phone = ${f.client_phone}, updated_at = NOW() WHERE id = ${id}`;
    if (f.client_email !== undefined) await sql`UPDATE proposals SET client_email = ${f.client_email}, updated_at = NOW() WHERE id = ${id}`;
    if (f.client_address !== undefined) await sql`UPDATE proposals SET client_address = ${f.client_address}, updated_at = NOW() WHERE id = ${id}`;
    if (f.client_city !== undefined) await sql`UPDATE proposals SET client_city = ${f.client_city}, updated_at = NOW() WHERE id = ${id}`;
    if (f.client_state !== undefined) await sql`UPDATE proposals SET client_state = ${f.client_state}, updated_at = NOW() WHERE id = ${id}`;
    if (f.client_zip !== undefined) await sql`UPDATE proposals SET client_zip = ${f.client_zip}, updated_at = NOW() WHERE id = ${id}`;
    if (f.total !== undefined) await sql`UPDATE proposals SET total = ${f.total}, updated_at = NOW() WHERE id = ${id}`;
    if (f.spot_holding_fee !== undefined) await sql`UPDATE proposals SET spot_holding_fee = ${f.spot_holding_fee}, updated_at = NOW() WHERE id = ${id}`;
    if (f.deposit !== undefined) await sql`UPDATE proposals SET deposit = ${f.deposit}, updated_at = NOW() WHERE id = ${id}`;
    if (f.installment_2 !== undefined) await sql`UPDATE proposals SET installment_2 = ${f.installment_2}, updated_at = NOW() WHERE id = ${id}`;
    if (f.installment_3 !== undefined) await sql`UPDATE proposals SET installment_3 = ${f.installment_3}, updated_at = NOW() WHERE id = ${id}`;
    if (f.footage !== undefined) await sql`UPDATE proposals SET footage = ${f.footage}, updated_at = NOW() WHERE id = ${id}`;
    if (f.panels !== undefined) await sql`UPDATE proposals SET panels = ${f.panels}, updated_at = NOW() WHERE id = ${id}`;
    if (f.extra_posts !== undefined) await sql`UPDATE proposals SET extra_posts = ${f.extra_posts}, updated_at = NOW() WHERE id = ${id}`;
    if (f.gate_count !== undefined) await sql`UPDATE proposals SET gate_count = ${f.gate_count}, updated_at = NOW() WHERE id = ${id}`;
    if (f.height !== undefined) await sql`UPDATE proposals SET height = ${f.height}, updated_at = NOW() WHERE id = ${id}`;
    if (f.color !== undefined) await sql`UPDATE proposals SET color = ${f.color}, updated_at = NOW() WHERE id = ${id}`;
    if (f.material !== undefined) await sql`UPDATE proposals SET material = ${f.material}, updated_at = NOW() WHERE id = ${id}`;
    if (f.notes !== undefined) await sql`UPDATE proposals SET notes = ${f.notes ? normalizeText(f.notes) : null}, updated_at = NOW() WHERE id = ${id}`;
    if (f.description_override !== undefined) await sql`UPDATE proposals SET description_override = ${f.description_override ? normalizeText(f.description_override) : null}, updated_at = NOW() WHERE id = ${id}`;
    return NextResponse.json({ success: true });
  }

  if (action === 'update_status') {
    await sql`UPDATE proposals SET status = ${body.status}, updated_at = NOW() WHERE id = ${body.id}`;
    return NextResponse.json({ success: true });
  }

  if (action === 'redact') {
    await sql`UPDATE proposals SET redacted = true, status = 'cancelled', updated_at = NOW() WHERE id = ${body.id}`;
    return NextResponse.json({ success: true });
  }

  if (action === 'unredact') {
    await sql`UPDATE proposals SET redacted = false, updated_at = NOW() WHERE id = ${body.id}`;
    return NextResponse.json({ success: true });
  }

  if (action === 'delete') {
    await sql`DELETE FROM proposals WHERE id = ${body.id}`;
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
