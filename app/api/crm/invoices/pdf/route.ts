import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { crmProfileConfig, normalizeCrmProfile } from '@/lib/email-policy';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function isAdmin(request: NextRequest): boolean {
  const auth = request.headers.get('authorization') || '';
  const token = auth.replace('Bearer ', '');
  return token === (process.env.ADMIN_TOKEN || 'hc-admin-2026');
}

function escapeHtml(value: unknown): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function money(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Amount pending';
  const n = Number(value);
  if (!Number.isFinite(n)) return 'Amount pending';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function companyBlock(profileKey: string) {
  if (profileKey === 'lowes_fencing') {
    return {
      name: 'PNM Fencing NJ LLC',
      sub: 'd/b/a Lowes Fencing NJ',
      phone: '(908) 692-4847',
      email: 'pnmfencing@gmail.com',
      hidePoBox: true,
    };
  }
  if (profileKey === 'pnm_fencing') {
    return {
      name: 'PNM Fencing',
      sub: 'PO Box 437 Oakhurst, NJ 07712',
      phone: '1-(908)-692-4847',
      email: 'pnmfencing@homecrafter.ai',
      hidePoBox: false,
    };
  }
  return {
    name: 'FenceCrafters',
    sub: 'PO Box 437 Oakhurst, NJ 07712',
    phone: '1-(908)-692-4847',
    email: 'fencecrafters@homecrafter.ai',
    hidePoBox: false,
  };
}

function publicPdfPath(raw: unknown): string | null {
  if (!raw) return null;
  let path = String(raw).trim();
  if (!path) return null;
  // Allow stored forms: /invoices/foo.pdf, invoices/foo.pdf, /public/invoices/foo.pdf
  path = path.replace(/^\/public(?=\/)/, '');
  if (!path.startsWith('/')) path = '/' + path;
  if (!path.startsWith('/invoices/')) return null;
  // Only allow simple public invoice assets (no traversal)
  if (path.includes('..') || path.includes('\\')) return null;
  return path;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenParam = searchParams.get('token');
  const adminToken = process.env.ADMIN_TOKEN || 'hc-admin-2026';
  if (!isAdmin(request) && tokenParam !== adminToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const idRaw = searchParams.get('id') || searchParams.get('invoice_id');
  const invoiceNo = searchParams.get('invoice_no');
  if (!idRaw && !invoiceNo) {
    return NextResponse.json({ error: 'id or invoice_no required' }, { status: 400 });
  }

  const forceGenerate = searchParams.get('generate') === '1' || searchParams.get('force') === '1';

  let rows;
  if (idRaw) {
    const id = parseInt(idRaw, 10);
    if (!Number.isFinite(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    rows = await sql`
      SELECT i.*,
             l.customer_name AS lead_name,
             l.customer_phone AS lead_phone,
             l.customer_email AS lead_email,
             l.customer_address AS lead_address,
             l.customer_city AS lead_city,
             l.customer_state AS lead_state,
             l.customer_zip AS lead_zip,
             l.lead_code,
             l.twister_work_order,
             l.lowes_store,
             p.estimate_no AS proposal_estimate_no
      FROM crm_invoices i
      LEFT JOIN crm_leads l ON l.id = i.crm_lead_id
      LEFT JOIN proposals p ON p.id = i.proposal_id
      WHERE i.id = ${id}
    `;
  } else {
    rows = await sql`
      SELECT i.*,
             l.customer_name AS lead_name,
             l.customer_phone AS lead_phone,
             l.customer_email AS lead_email,
             l.customer_address AS lead_address,
             l.customer_city AS lead_city,
             l.customer_state AS lead_state,
             l.customer_zip AS lead_zip,
             l.lead_code,
             l.twister_work_order,
             l.lowes_store,
             p.estimate_no AS proposal_estimate_no
      FROM crm_invoices i
      LEFT JOIN crm_leads l ON l.id = i.crm_lead_id
      LEFT JOIN proposals p ON p.id = i.proposal_id
      WHERE i.invoice_no = ${invoiceNo}
      ORDER BY i.id DESC
      LIMIT 1
    `;
  }

  if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const inv = rows[0] as Record<string, unknown>;

  const staticPath = publicPdfPath(inv.pdf_path);
  if (staticPath && !forceGenerate) {
    // Prefer handcrafted static invoice PDF/HTML when linked on the ledger row.
    const origin = new URL(request.url).origin;
    return NextResponse.redirect(new URL(staticPath, origin), 302);
  }

  const profileKey = normalizeCrmProfile(inv.crm_profile || searchParams.get('profile'));
  const profile = crmProfileConfig(profileKey);
  const company = companyBlock(profileKey);
  const status = String(inv.status || 'unpaid').toLowerCase();
  const statusLabel = status.toUpperCase();
  const statusColor =
    status === 'paid' ? '#166534' : status === 'void' ? '#64748b' : '#9a3412';
  const statusBg =
    status === 'paid' ? '#f0fdf4' : status === 'void' ? '#f8fafc' : '#fff7ed';
  const statusBorder =
    status === 'paid' ? '#86efac' : status === 'void' ? '#cbd5e1' : '#fdba74';

  const invoiceLabel = inv.invoice_no
    ? String(inv.invoice_no)
    : `CRM-${inv.id}`;
  const createdAt = inv.created_at ? new Date(String(inv.created_at)) : new Date();
  const dateStr = createdAt.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const paidAtStr = inv.paid_at
    ? new Date(String(inv.paid_at)).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '';

  const addressLine = [inv.lead_address, inv.lead_city, inv.lead_state, inv.lead_zip]
    .filter(Boolean)
    .map(escapeHtml)
    .join(', ');

  const amountPending = Boolean(inv.amount_pending) || inv.amount === null || inv.amount === undefined || inv.amount === '';
  const amountDisplay = amountPending ? 'Amount pending' : money(inv.amount);
  const description = String(inv.description || '').trim() || 'Invoice';

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(company.name)} Invoice ${escapeHtml(invoiceLabel)}</title>
<style>
  body { font-family: Helvetica, Arial, sans-serif; max-width: 780px; margin: 0 auto; padding: 40px 30px; color: #1f2933; font-size: 11pt; line-height: 1.5; }
  .top { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #1f2933; padding-bottom: 18px; gap: 1rem; }
  h1 { margin: 0; font-size: 30px; letter-spacing: 1px; }
  .muted { color: #667085; font-size: 10pt; margin-top: 6px; }
  .badge { margin-top: 10px; display: inline-block; background: ${statusBg}; color: ${statusColor}; border: 1px solid ${statusBorder}; border-radius: 999px; padding: 6px 12px; font-weight: bold; letter-spacing: .5px; font-size: 10px; }
  .company { font-size: 12px; line-height: 1.45; text-align: right; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 36px; margin-top: 28px; }
  .box-title { font-size: 11px; text-transform: uppercase; color: #667085; font-weight: bold; letter-spacing: .8px; margin-bottom: 8px; }
  .details { width: 100%; border-collapse: collapse; margin-top: 4px; }
  .details td { padding: 5px 0; vertical-align: top; font-size: 10.5pt; }
  .details td:first-child { color: #667085; width: 140px; }
  .items { width: 100%; border-collapse: collapse; margin-top: 34px; }
  .items th { background: #1f2933; color: white; text-align: left; padding: 12px; font-size: 12px; text-transform: uppercase; letter-spacing: .5px; }
  .items td { border-bottom: 1px solid #e5e7eb; padding: 14px 12px; vertical-align: top; }
  .amount { text-align: right; white-space: nowrap; font-weight: 700; }
  .totals { margin-left: auto; width: 320px; margin-top: 24px; border-collapse: collapse; }
  .totals td { padding: 8px 0; border-bottom: 1px solid #e5e7eb; }
  .totals td:last-child { text-align: right; font-weight: bold; }
  .total-row td { font-size: 17px; border-bottom: 3px solid #1f2933; padding-top: 12px; }
  .note { margin-top: 28px; padding: 14px 16px; background: #f8fafc; border-left: 4px solid #1f2933; line-height: 1.55; font-size: 10pt; }
  .footer { margin-top: 40px; font-size: 11px; color: #667085; border-top: 1px solid #e5e7eb; padding-top: 12px; }
  .print-btn { position: fixed; top: 10px; right: 10px; background: #1e1845; color: #c4aa6a; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-weight: bold; font-size: 12px; z-index: 10; }
  @media print { .print-btn { display: none; } }
  @media (max-width: 640px) { .grid { grid-template-columns: 1fr; } body { padding: 20px 14px; } }
</style></head><body>
<button class="print-btn" onclick="window.print()">🖨 Print / Save PDF</button>

<div class="top">
  <div>
    <h1>INVOICE</h1>
    <div class="muted">${escapeHtml(profile.label)} · CRM ledger</div>
    <div class="badge">${escapeHtml(statusLabel)}</div>
  </div>
  <div class="company">
    <strong>${escapeHtml(company.name)}</strong><br>
    ${company.sub ? escapeHtml(company.sub) + '<br>' : ''}
    Phone: ${escapeHtml(company.phone)}<br>
    ${escapeHtml(company.email)}
  </div>
</div>

<div class="grid">
  <div>
    <div class="box-title">Bill To</div>
    <strong>${escapeHtml(inv.lead_name || 'Customer')}</strong><br>
    ${inv.lead_email ? escapeHtml(inv.lead_email) + '<br>' : ''}
    ${inv.lead_phone ? escapeHtml(inv.lead_phone) + '<br>' : ''}
    ${addressLine || ''}
  </div>
  <div>
    <div class="box-title">Invoice Details</div>
    <table class="details">
      <tr><td>Invoice #</td><td><strong>${escapeHtml(invoiceLabel)}</strong></td></tr>
      <tr><td>CRM Invoice ID</td><td>${escapeHtml(inv.id)}</td></tr>
      ${inv.proposal_estimate_no ? `<tr><td>Proposal #</td><td>${escapeHtml(inv.proposal_estimate_no)}</td></tr>` : ''}
      ${inv.lead_code ? `<tr><td>Lead #</td><td>${escapeHtml(inv.lead_code)}</td></tr>` : ''}
      ${inv.twister_work_order ? `<tr><td>Twister WO</td><td>${escapeHtml(inv.twister_work_order)}</td></tr>` : ''}
      ${inv.lowes_store ? `<tr><td>Store</td><td>${escapeHtml(inv.lowes_store)}</td></tr>` : ''}
      <tr><td>Invoice Date</td><td>${escapeHtml(dateStr)}</td></tr>
      <tr><td>Due</td><td>Due upon receipt</td></tr>
      <tr><td>Status</td><td><strong>${escapeHtml(statusLabel)}</strong></td></tr>
      ${paidAtStr ? `<tr><td>Paid</td><td>${escapeHtml(paidAtStr)}${inv.payment_reference ? ' · ref ' + escapeHtml(inv.payment_reference) : ''}</td></tr>` : ''}
    </table>
  </div>
</div>

<table class="items">
  <thead><tr><th>Description</th><th class="amount">Amount</th></tr></thead>
  <tbody>
    <tr>
      <td style="white-space:pre-line">${escapeHtml(description)}</td>
      <td class="amount">${escapeHtml(amountDisplay)}</td>
    </tr>
  </tbody>
</table>

<table class="totals">
  <tr><td>Subtotal</td><td>${escapeHtml(amountDisplay)}</td></tr>
  <tr><td>Tax</td><td>$0.00</td></tr>
  <tr class="total-row"><td>${status === 'paid' ? 'Total Paid' : 'Total Due'}</td><td>${escapeHtml(amountDisplay)}</td></tr>
</table>

${inv.payment_note ? `<div class="note"><strong>Payment note:</strong><br>${escapeHtml(inv.payment_note)}</div>` : ''}

<div class="note">
  <strong>Payment instructions:</strong><br>
  Please make check / electronic payment payable to <strong>${escapeHtml(company.name)}</strong>.
  ${invoiceLabel ? `<br><br>Memo: <strong>${escapeHtml(invoiceLabel)}${inv.twister_work_order ? ' / WO ' + escapeHtml(inv.twister_work_order) : ''}${inv.lead_name ? ' / ' + escapeHtml(inv.lead_name) : ''}</strong>` : ''}
</div>

<div class="footer">Generated from Homecrafter CRM · ${escapeHtml(profile.label)} · ${escapeHtml(dateStr)}</div>
</body></html>`;

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
