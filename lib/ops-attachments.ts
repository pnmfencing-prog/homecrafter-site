import fs from 'node:fs/promises';
import path from 'node:path';
import sql from '@/lib/db';
import { parseAttachmentRefs, checkTotalSize, sanitizeFileName, sniffMime } from '@/lib/ops-attachments-core.mjs';

export type ResolvedAttachment = {
  fileName: string;
  mime: string;
  bytes: Buffer;
  attachmentId: number | null;
  invoiceId: number | null;
  invoiceNo: string | null;
};

/** Read an invoice PDF from its durable DB copy, else from /public (and back-fill the DB copy). */
export async function loadInvoicePdf(invoiceId: number): Promise<ResolvedAttachment & { invoice: Record<string, unknown> }> {
  const rows = await sql`SELECT * FROM crm_invoices WHERE id = ${invoiceId} LIMIT 1`;
  if (!rows.length) throw new Error(`Invoice ${invoiceId} not found`);
  const inv = rows[0];
  if (inv.pdf_attachment_id) {
    const a = await sql`SELECT id, file_name, mime_type, content_base64 FROM crm_attachments WHERE id = ${inv.pdf_attachment_id} LIMIT 1`;
    if (a.length) {
      return { fileName: a[0].file_name, mime: a[0].mime_type, bytes: Buffer.from(a[0].content_base64, 'base64'),
        attachmentId: a[0].id, invoiceId, invoiceNo: inv.invoice_no, invoice: inv };
    }
  }
  const rel = String(inv.pdf_path || '');
  if (!rel.startsWith('/invoices/') || rel.includes('..') || !rel.endsWith('.pdf')) throw new Error(`Invoice ${inv.invoice_no || invoiceId} has no PDF`);
  const bytes = await fs.readFile(path.join(process.cwd(), 'public', rel));
  if (sniffMime(bytes) !== 'application/pdf') throw new Error('Invoice file is not a PDF');
  const fileName = sanitizeFileName(path.basename(rel));
  const ins = await sql`
    INSERT INTO crm_attachments (crm_lead_id, file_name, mime_type, content_base64, size_bytes, direction)
    VALUES (${inv.crm_lead_id}, ${fileName}, 'application/pdf', ${bytes.toString('base64')}, ${bytes.length}, 'outbound')
    RETURNING id`;
  await sql`UPDATE crm_invoices SET pdf_attachment_id = ${ins[0].id}, updated_at = NOW() WHERE id = ${invoiceId}`;
  return { fileName, mime: 'application/pdf', bytes, attachmentId: ins[0].id, invoiceId, invoiceNo: inv.invoice_no, invoice: inv };
}

export async function resolveAttachments(raw: unknown, vendorId: string): Promise<ResolvedAttachment[]> {
  const parsed = parseAttachmentRefs(raw);
  if (!parsed.ok) throw new Error(parsed.error);
  const out: ResolvedAttachment[] = [];
  for (const ref of parsed.refs as { kind: string; id: number }[]) {
    if (ref.kind === 'invoice') {
      out.push(await loadInvoicePdf(ref.id));
    } else {
      // Uploads are only attachable from the vendor they were uploaded to.
      const a = await sql`SELECT id, file_name, mime_type, content_base64 FROM crm_attachments
        WHERE id = ${ref.id} AND vendor_id = ${vendorId}::uuid LIMIT 1`;
      if (!a.length) throw new Error(`Attachment ${ref.id} not found for this vendor`);
      out.push({ fileName: a[0].file_name, mime: a[0].mime_type, bytes: Buffer.from(a[0].content_base64, 'base64'),
        attachmentId: a[0].id, invoiceId: null, invoiceNo: null });
    }
  }
  const size = checkTotalSize(out);
  if (!size.ok) throw new Error(size.error);
  return out;
}
