// Pure helpers for Ops email attachments + invoice tracking (unit-tested in tests/).
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;   // per file
export const MAX_TOTAL_BYTES = 15 * 1024 * 1024;       // Brevo limit headroom
export const MAX_ATTACHMENTS = 5;
export const ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/webp'];

export function sanitizeFileName(name) {
  const base = String(name || 'attachment').split(/[\\/]/).pop() || 'attachment';
  const cleaned = base.replace(/[^A-Za-z0-9._ -]/g, '_').replace(/^\.+/, '').slice(0, 120);
  return cleaned || 'attachment';
}

export function sniffMime(buf) {
  if (!buf || buf.length < 4) return null;
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return 'application/pdf';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length > 12 && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.length > 12 && buf.toString('ascii', 4, 8) === 'ftyp') return 'image/heic';
  return null;
}

/** Validate an upload: returns { ok, error?, mime, bytes, fileName }. Content is checked by magic bytes, not the claimed type. */
export function validateUpload({ file_name, content_base64 }) {
  if (!content_base64 || typeof content_base64 !== 'string') return { ok: false, error: 'content_base64 required' };
  const bytes = Buffer.from(content_base64, 'base64');
  if (!bytes.length) return { ok: false, error: 'empty file' };
  if (bytes.length > MAX_ATTACHMENT_BYTES) return { ok: false, error: 'file too large (max 8MB)' };
  const mime = sniffMime(bytes);
  if (!mime || !ALLOWED_MIME.includes(mime)) return { ok: false, error: 'only PDF or image files are allowed' };
  return { ok: true, mime, bytes, fileName: sanitizeFileName(file_name) };
}

/** Normalize the attachments array on a send request into typed refs. */
export function parseAttachmentRefs(raw) {
  if (raw == null) return { ok: true, refs: [] };
  if (!Array.isArray(raw)) return { ok: false, error: 'attachments must be an array' };
  if (raw.length > MAX_ATTACHMENTS) return { ok: false, error: `max ${MAX_ATTACHMENTS} attachments` };
  const refs = [];
  const seen = new Set();
  for (const item of raw) {
    const inv = Number(item && item.invoice_id);
    const att = Number(item && item.attachment_id);
    let ref;
    if (Number.isInteger(inv) && inv > 0) ref = { kind: 'invoice', id: inv };
    else if (Number.isInteger(att) && att > 0) ref = { kind: 'attachment', id: att };
    else return { ok: false, error: 'each attachment needs invoice_id or attachment_id' };
    const key = ref.kind + ':' + ref.id;
    if (!seen.has(key)) { seen.add(key); refs.push(ref); }
  }
  return { ok: true, refs };
}

export function checkTotalSize(files) {
  const total = files.reduce((s, f) => s + (f.bytes ? f.bytes.length : 0), 0);
  return total <= MAX_TOTAL_BYTES ? { ok: true, total } : { ok: false, total, error: 'attachments exceed 15MB total' };
}

/** Public, tracked invoice link (logs an open, then serves the PDF). */
export function trackedInvoiceUrl(origin, invoiceNo, recipient, src = 'ops_email') {
  const q = new URLSearchParams();
  if (recipient) q.set('r', recipient);
  q.set('src', src);
  return `${String(origin).replace(/\/$/, '')}/api/invoices/${encodeURIComponent(invoiceNo)}?${q.toString()}`;
}

const BOT_UA = /(bot|crawler|spider|preview|GoogleImageProxy|Barracuda|Proofpoint|Mimecast|curl|wget|python-requests|HeadlessChrome)/i;
/** Link scanners and mail proxies prefetch links; flag them so they don't count as human opens. */
export function isLikelyBot(userAgent) {
  return !userAgent || BOT_UA.test(String(userAgent));
}

/** Score a bank transaction (e.g. Plaid) against an open invoice. 0..1. Amount must match to the cent. */
export function scorePaymentMatch(invoice, txn) {
  if (!invoice || !txn || invoice.status !== 'unpaid') return 0;
  const amt = Math.round(Math.abs(Number(txn.amount)) * 100);
  const due = Math.round(Number(invoice.amount) * 100);
  if (!due || amt !== due) return 0;
  let score = 0.6;
  const memo = String(txn.name || '') + ' ' + String(txn.memo || '');
  const digits = String(invoice.invoice_no || '').replace(/\D/g, '');
  if (digits && new RegExp('(^|\\D)' + digits + '(\\D|$)').test(memo)) score += 0.3;
  const payer = String(invoice.payer_name || '').toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  if (payer.some((w) => memo.toLowerCase().includes(w))) score += 0.1;
  return Math.min(1, Number(score.toFixed(3)));
}
