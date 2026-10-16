import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { isCrmAdmin } from '@/lib/crm-admin';
import { validateUpload } from '@/lib/ops-attachments-core.mjs';

export const dynamic = 'force-dynamic';

/** GET ?vendor_id= → attachable invoices (vendor-linked first, then same-profile open invoices) + this vendor's uploads. */
export async function GET(request: NextRequest) {
  if (!isCrmAdmin(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const vendorId = request.nextUrl.searchParams.get('vendor_id') || '';
  const v = await sql`SELECT id, crm_profile FROM crm_vendor_profiles WHERE id = ${vendorId}::uuid LIMIT 1`;
  if (!v.length) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 });
  const invoices = await sql`
    SELECT i.id, i.invoice_no, i.description, i.amount, i.status, i.pdf_path, i.crm_lead_id, i.open_count,
           i.first_opened_at, i.paid_at, l.customer_name AS lead_name, (i.vendor_id = ${vendorId}::uuid) AS linked
    FROM crm_invoices i LEFT JOIN crm_leads l ON l.id = i.crm_lead_id
    WHERE i.status <> 'void' AND (i.pdf_path IS NOT NULL OR i.pdf_attachment_id IS NOT NULL)
      AND (i.vendor_id = ${vendorId}::uuid OR i.crm_profile = ${v[0].crm_profile})
    ORDER BY (i.vendor_id = ${vendorId}::uuid) DESC NULLS LAST, i.created_at DESC
    LIMIT 50`;
  const uploads = await sql`
    SELECT id, file_name, mime_type, size_bytes, created_at FROM crm_attachments
    WHERE vendor_id = ${vendorId}::uuid ORDER BY created_at DESC LIMIT 50`;
  return NextResponse.json({ invoices, uploads });
}

/** POST { vendor_id, file_name, content_base64 } → stores a PDF/image upload durably for this vendor. */
export async function POST(request: NextRequest) {
  if (!isCrmAdmin(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const vendorId = String(body.vendor_id || '');
  const v = await sql`SELECT id FROM crm_vendor_profiles WHERE id = ${vendorId}::uuid LIMIT 1`;
  if (!v.length) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 });
  const r = validateUpload(body);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  const rows = await sql`
    INSERT INTO crm_attachments (crm_lead_id, vendor_id, file_name, mime_type, content_base64, size_bytes, direction)
    VALUES (NULL, ${vendorId}::uuid, ${r.fileName}, ${r.mime}, ${r.bytes!.toString('base64')}, ${r.bytes!.length}, 'outbound')
    RETURNING id, file_name, mime_type, size_bytes`;
  return NextResponse.json({ success: true, attachment: rows[0], url: `/api/crm-attachments/${rows[0].id}` });
}
