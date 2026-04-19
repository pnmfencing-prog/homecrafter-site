import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { generateProposalPDF } from '@/lib/generate-pdf';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');
  const adminToken = process.env.ADMIN_TOKEN || 'hc-admin-2026';
  if (token !== adminToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id = searchParams.get('id');
  const estNo = searchParams.get('estimate_no');

  let proposals;
  if (id) {
    proposals = await sql`SELECT * FROM proposals WHERE id = ${parseInt(id)}`;
  } else if (estNo) {
    proposals = await sql`SELECT * FROM proposals WHERE estimate_no = ${estNo}`;
  } else {
    return NextResponse.json({ error: 'id or estimate_no required' }, { status: 400 });
  }

  if (!proposals.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const p = proposals[0];

  const pdfBuffer = await generateProposalPDF({
    estimate_no: p.estimate_no,
    client_name: p.client_name,
    client_email: p.client_email,
    client_address: p.client_address,
    client_city: p.client_city,
    client_state: p.client_state,
    client_zip: p.client_zip,
    footage: Number(p.footage) || 0,
    height: p.height,
    color: p.color,
    material: p.material,
    gate_count: Number(p.gate_count) || 0,
    panels: Number(p.panels) || 0,
    removal_type: p.removal_type,
    removal_footage: Number(p.removal_footage) || 0,
    total: Number(p.total) || 0,
    deposit: Number(p.deposit) || 0,
    installment_2: Number(p.installment_2) || 0,
    installment_3: Number(p.installment_3) || 0,
    spot_holding_fee: Number(p.spot_holding_fee) || 150,
    description_override: p.description_override,
    created_at: p.created_at,
  });

  return new NextResponse(pdfBuffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="PNM-Estimate-${p.estimate_no}.pdf"`,
    },
  });
}
