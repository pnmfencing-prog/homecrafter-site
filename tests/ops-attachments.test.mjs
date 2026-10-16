import test from 'node:test';
import assert from 'node:assert/strict';
import * as c from '../lib/ops-attachments-core.mjs';
import fs from 'node:fs';

const pdf = fs.readFileSync(new URL('../public/invoices/invoice-1302-stephanie-gaber-newage-1570.pdf', import.meta.url));

test('accepts a real PDF by magic bytes', () => {
  const r = c.validateUpload({ file_name: '../../etc/INV 1302.pdf', content_base64: pdf.toString('base64') });
  assert.equal(r.ok, true); assert.equal(r.mime, 'application/pdf'); assert.equal(r.fileName, 'INV 1302.pdf');
});
test('rejects non-PDF/image content even if named .pdf', () => {
  const r = c.validateUpload({ file_name: 'x.pdf', content_base64: Buffer.from('<html>hi</html>').toString('base64') });
  assert.equal(r.ok, false);
});
test('rejects oversize and empty', () => {
  const big = Buffer.concat([Buffer.from('%PDF'), Buffer.alloc(c.MAX_ATTACHMENT_BYTES)]);
  assert.equal(c.validateUpload({ content_base64: big.toString('base64') }).ok, false);
  assert.equal(c.validateUpload({ content_base64: '' }).ok, false);
});
test('parses refs, dedupes, caps count', () => {
  assert.deepEqual(c.parseAttachmentRefs([{ invoice_id: 2 }, { invoice_id: '2' }, { attachment_id: 9 }]).refs,
    [{ kind: 'invoice', id: 2 }, { kind: 'attachment', id: 9 }]);
  assert.equal(c.parseAttachmentRefs([{}]).ok, false);
  assert.equal(c.parseAttachmentRefs('x').ok, false);
  assert.equal(c.parseAttachmentRefs(Array.from({ length: 6 }, (_, i) => ({ attachment_id: i + 1 }))).ok, false);
  assert.deepEqual(c.parseAttachmentRefs(undefined).refs, []);
});
test('total size cap', () => {
  assert.equal(c.checkTotalSize([{ bytes: Buffer.alloc(10) }]).ok, true);
  assert.equal(c.checkTotalSize([{ bytes: Buffer.alloc(c.MAX_TOTAL_BYTES + 1) }]).ok, false);
});
test('tracked URL', () => {
  assert.equal(c.trackedInvoiceUrl('https://homecrafter.ai/', 'INV-1302', 'a@b.com'),
    'https://homecrafter.ai/api/invoices/INV-1302?r=a%40b.com&src=ops_email');
});
test('bot detection for link scanners', () => {
  assert.equal(c.isLikelyBot('Mozilla/5.0 (iPhone) Safari'), false);
  assert.equal(c.isLikelyBot('Mozilla/5.0 (via ggpht.com GoogleImageProxy)'), true);
  assert.equal(c.isLikelyBot(''), true);
});
test('payment match scoring (Plaid-ready)', () => {
  const inv = { status: 'unpaid', amount: '1570.59', invoice_no: 'INV-1302', payer_name: 'New Age Install' };
  assert.equal(c.scorePaymentMatch(inv, { amount: -1570.59, name: 'ACH NEW AGE INSTALL INV 1302' }), 1);
  assert.equal(c.scorePaymentMatch(inv, { amount: 1570.59, name: 'deposit' }), 0.6);
  assert.equal(c.scorePaymentMatch(inv, { amount: 1570.5, name: 'INV 1302' }), 0);
  assert.equal(c.scorePaymentMatch({ ...inv, status: 'paid' }, { amount: 1570.59 }), 0);
  assert.equal(c.scorePaymentMatch(inv, { amount: 1570.59, name: 'INV 13021' }), 0.6); // no false invoice# hit
});
