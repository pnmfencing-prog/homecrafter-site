// Pure helpers for linking a stored PDF (crm_attachments) to a crm_invoices row on create/update.
// Root cause (10/23, INV-1309/INV-1310): POST /api/crm/invoices ignored pdf_attachment_id, so rows were
// created with pdf_attachment_id NULL and /api/invoices/<no> 500'd or served the wrong PDF until hand-linked.
import { validateUpload } from './ops-attachments-core.mjs';

function present(v) { return v !== undefined && v !== null && v !== ''; }

/**
 * Read the PDF-link intent from a create/update body.
 * Accepts pdf_attachment_id (alias attachment_id) OR an inline PDF (pdf_base64 / pdf_content_base64 + pdf_file_name).
 * Returns { ok, mode: 'none' | 'attachment' | 'upload', attachmentId?, upload?, error? }.
 */
export function parseInvoicePdfInput(body) {
  const b = body || {};
  const rawId = present(b.pdf_attachment_id) ? b.pdf_attachment_id : b.attachment_id;
  const rawPdf = present(b.pdf_base64) ? b.pdf_base64 : b.pdf_content_base64;
  const hasId = present(rawId);
  const hasPdf = present(rawPdf);
  if (hasId && hasPdf) return { ok: false, error: 'send pdf_attachment_id or pdf_base64, not both' };
  if (hasId) {
    const n = Number(rawId);
    if (!Number.isInteger(n) || n <= 0) return { ok: false, error: 'invalid pdf_attachment_id' };
    return { ok: true, mode: 'attachment', attachmentId: n };
  }
  if (hasPdf) {
    const content = String(rawPdf).replace(/^data:[^;]+;base64,/, '');
    const r = validateUpload({ file_name: b.pdf_file_name || b.file_name || 'invoice.pdf', content_base64: content });
    if (!r.ok) return { ok: false, error: 'pdf_base64: ' + r.error };
    if (r.mime !== 'application/pdf') return { ok: false, error: 'pdf_base64 must be a PDF' };
    let fileName = r.fileName;
    if (!/\.pdf$/i.test(fileName)) fileName += '.pdf';
    return { ok: true, mode: 'upload', upload: { fileName, bytes: r.bytes } };
  }
  return { ok: true, mode: 'none' };
}

/**
 * Check an existing crm_attachments row can be linked to an invoice for leadId.
 * att: { id, crm_lead_id, mime_type } | null; otherInvoiceIds: invoices (other than this one) already using it.
 */
export function checkLinkableAttachment(att, leadId, otherInvoiceIds = []) {
  if (!att) return { ok: false, status: 404, error: 'pdf_attachment_id not found' };
  if (String(att.mime_type || '').toLowerCase() !== 'application/pdf') {
    return { ok: false, status: 400, error: 'pdf_attachment_id is not a PDF' };
  }
  if (att.crm_lead_id != null && Number(att.crm_lead_id) !== Number(leadId)) {
    return { ok: false, status: 400, error: `attachment ${att.id} belongs to lead ${att.crm_lead_id}, not ${leadId}` };
  }
  if (otherInvoiceIds.length) {
    return { ok: false, status: 409, error: `attachment ${att.id} is already linked to invoice id ${otherInvoiceIds.join(', ')}` };
  }
  return { ok: true };
}
