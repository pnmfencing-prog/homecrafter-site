import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseInvoicePdfInput, checkLinkableAttachment } from '../lib/invoice-pdf-link-core.mjs';

const pdf = fs.readFileSync(new URL('../public/invoices/invoice-1302-stephanie-gaber-newage-1570.pdf', import.meta.url));

test('no pdf fields → none (create still works without a PDF)', () => {
  assert.deepEqual(parseInvoicePdfInput({ crm_lead_id: 1 }), { ok: true, mode: 'none' });
  assert.deepEqual(parseInvoicePdfInput({ pdf_attachment_id: null }), { ok: true, mode: 'none' });
  assert.deepEqual(parseInvoicePdfInput(undefined), { ok: true, mode: 'none' });
});
test('pdf_attachment_id is read (the INV-1309/1310 regression), string or number, alias attachment_id', () => {
  assert.deepEqual(parseInvoicePdfInput({ pdf_attachment_id: 405 }), { ok: true, mode: 'attachment', attachmentId: 405 });
  assert.deepEqual(parseInvoicePdfInput({ pdf_attachment_id: '401' }), { ok: true, mode: 'attachment', attachmentId: 401 });
  assert.deepEqual(parseInvoicePdfInput({ attachment_id: 7 }), { ok: true, mode: 'attachment', attachmentId: 7 });
});
test('bad pdf_attachment_id rejected', () => {
  for (const v of ['abc', 0, -3, 1.5]) assert.equal(parseInvoicePdfInput({ pdf_attachment_id: v }).ok, false);
});
test('inline PDF upload is accepted and named .pdf', () => {
  const r = parseInvoicePdfInput({ pdf_base64: 'data:application/pdf;base64,' + pdf.toString('base64'), pdf_file_name: 'INV-1311 Belby' });
  assert.equal(r.ok, true); assert.equal(r.mode, 'upload');
  assert.equal(r.upload.fileName, 'INV-1311 Belby.pdf');
  assert.equal(r.upload.bytes.length, pdf.length);
});
test('inline non-PDF rejected (image or html)', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]).toString('base64');
  assert.equal(parseInvoicePdfInput({ pdf_base64: png }).ok, false);
  assert.equal(parseInvoicePdfInput({ pdf_base64: Buffer.from('<html>').toString('base64') }).ok, false);
});
test('both id and inline PDF is ambiguous → rejected', () => {
  assert.equal(parseInvoicePdfInput({ pdf_attachment_id: 1, pdf_base64: pdf.toString('base64') }).ok, false);
});
test('linkable attachment checks: exists, PDF, same lead (or lead-less), not linked elsewhere', () => {
  assert.equal(checkLinkableAttachment(null, 1).status, 404);
  assert.equal(checkLinkableAttachment({ id: 400, crm_lead_id: 12216, mime_type: 'image/jpeg' }, 12216).ok, false);
  assert.equal(checkLinkableAttachment({ id: 405, crm_lead_id: 12216, mime_type: 'application/pdf' }, 12216).ok, true);
  assert.equal(checkLinkableAttachment({ id: 9, crm_lead_id: null, mime_type: 'application/pdf' }, 12216).ok, true);
  assert.equal(checkLinkableAttachment({ id: 405, crm_lead_id: 12216, mime_type: 'application/pdf' }, 12098).ok, false);
  assert.equal(checkLinkableAttachment({ id: 401, crm_lead_id: 12216, mime_type: 'application/pdf' }, 12216, [6]).status, 409);
});
