import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { generateProposalPDF } from '@/lib/generate-pdf';

function isAdmin(request: NextRequest): boolean {
  const auth = request.headers.get('authorization') || '';
  const token = auth.replace('Bearer ', '');
  const adminToken = process.env.ADMIN_TOKEN || 'hc-admin-2026';
  return token === adminToken;
}

function checkAuth(request: NextRequest): boolean {
  if (isAdmin(request)) return true;
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');
  return token === (process.env.ADMIN_TOKEN || 'hc-admin-2026');
}

export async function GET(request: NextRequest) {
  if (!checkAuth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const status = searchParams.get('status');
  const format = searchParams.get('format');

  // PDF download
  if (format === 'pdf' && id) {
    const proposals = await sql`SELECT * FROM proposals WHERE id = ${parseInt(id)}`;
    if (!proposals.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const p = proposals[0];
    const pdfBuffer = await generateProposalPDF({
      estimate_no: p.estimate_no, client_name: p.client_name, client_email: p.client_email,
      client_address: p.client_address, client_city: p.client_city, client_state: p.client_state, client_zip: p.client_zip,
      footage: Number(p.footage) || 0, height: p.height, color: p.color, material: p.material,
      gate_count: Number(p.gate_count) || 0, panels: Number(p.panels) || 0,
      removal_type: p.removal_type, removal_footage: Number(p.removal_footage) || 0,
      total: Number(p.total) || 0, deposit: Number(p.deposit) || 0,
      installment_2: Number(p.installment_2) || 0, installment_3: Number(p.installment_3) || 0,
      spot_holding_fee: Number(p.spot_holding_fee) || 150, description_override: p.description_override, created_at: p.created_at,
    });
    return new NextResponse(pdfBuffer, {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="PNM-Estimate-${p.estimate_no}.pdf"` },
    });
  }

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
      INSERT INTO proposals (estimate_no, crm_lead_id, client_name, client_email, client_address, client_city, client_state, client_zip,
        footage, height, color, material, gate_count, panels, extra_posts, removal_type, removal_footage,
        total, deposit, installment_2, installment_3, spot_holding_fee, status, pdf_filename, notes, description_override)
      VALUES (${estNo}, ${body.crm_lead_id || null}, ${body.client_name || null}, ${body.client_email || null},
        ${body.client_address || null}, ${body.client_city || null}, ${body.client_state || null}, ${body.client_zip || null},
        ${body.footage || null}, ${body.height || '6ft'}, ${body.color || 'White'}, ${body.material || 'vinyl'},
        ${body.gate_count || 0}, ${body.panels || null}, ${body.extra_posts || 2},
        ${body.removal_type || null}, ${body.removal_footage || 0},
        ${body.total || null}, ${body.deposit || null}, ${body.installment_2 || null}, ${body.installment_3 || null},
        ${body.spot_holding_fee || 150}, ${body.status || 'draft'}, ${body.pdf_filename || null},
        ${body.notes || null}, ${body.description_override || null})
      RETURNING *
    `;
    return NextResponse.json({ success: true, proposal: result[0] });
  }

  if (action === 'update_status') {
    await sql`UPDATE proposals SET status = ${body.status}, updated_at = NOW() WHERE id = ${body.id}`;
    return NextResponse.json({ success: true });
  }

  if (action === 'delete') {
    await sql`DELETE FROM proposals WHERE id = ${body.id}`;
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
