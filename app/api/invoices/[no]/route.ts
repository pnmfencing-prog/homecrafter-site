import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { loadInvoicePdf } from '@/lib/ops-attachments';
import { isLikelyBot } from '@/lib/ops-attachments-core.mjs';

export const dynamic = 'force-dynamic';

/** Public tracked invoice link: logs an open event (bots flagged, not counted), then serves the PDF inline. */
export async function GET(request: NextRequest, context: { params: Promise<{ no: string }> }) {
  const { no } = await context.params;
  const rows = await sql`SELECT id FROM crm_invoices WHERE lower(invoice_no) = lower(${no}) AND status <> 'void'
    ORDER BY id DESC LIMIT 1`;
  if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const id = rows[0].id as number;
  const ua = request.headers.get('user-agent') || '';
  const bot = isLikelyBot(ua);
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || '';
  try {
    await sql`INSERT INTO invoice_link_opens (invoice_no, crm_invoice_id, recipient, source, ip, user_agent, referer, is_bot)
      VALUES (${no}, ${id}, ${request.nextUrl.searchParams.get('r')}, ${request.nextUrl.searchParams.get('src') || 'invoice_link'},
              ${ip}, ${ua}, ${request.headers.get('referer') || ''}, ${bot})`;
    if (!bot) {
      await sql`UPDATE crm_invoices SET open_count = open_count + 1, last_opened_at = NOW(),
        first_opened_at = COALESCE(first_opened_at, NOW()) WHERE id = ${id}`;
    }
  } catch (e) { console.error('invoice open tracking failed', e); }
  const pdf = await loadInvoicePdf(id);
  return new NextResponse(new Uint8Array(pdf.bytes), { headers: {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="${pdf.fileName.replace(/["\r\n]/g, '')}"`,
    'Cache-Control': 'no-store',
  } });
}
