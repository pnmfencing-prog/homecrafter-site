import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { brevoAttachmentField } from '../lib/brevo-attachments-core.mjs';

// Regression: CRM lead email via POST /api/chat (no attachments) sent `attachment: []`
// and Brevo answered 400 "missing_parameter, attachment is missing" (lead 12117, 2026-10-17).
test('no attachments → attachment key omitted entirely', () => {
  for (const input of [[], undefined, null, 'x', [{ name: 'a.pdf', content: '' }], [{ name: 'a.pdf' }], [null]]) {
    const out = brevoAttachmentField(input);
    assert.deepEqual(out, {});
    assert.equal('attachment' in out, false);
    assert.equal(JSON.stringify({ subject: 's', ...out }).includes('attachment'), false);
  }
});

test('real attachments are kept, empty entries dropped, names capped', () => {
  const out = brevoAttachmentField([{ name: 'INV-1302.pdf', content: 'JVBERi0=' }, { name: 'x', content: '' }, { content: 'AAAA' }]);
  assert.deepEqual(out, { attachment: [{ name: 'INV-1302.pdf', content: 'JVBERi0=' }, { name: 'attachment', content: 'AAAA' }] });
  assert.equal(brevoAttachmentField([{ name: 'n'.repeat(300), content: 'AA' }]).attachment[0].name.length, 180);
});

test('chat route: email is sent before the CRM activity is logged, and uses the helper', () => {
  const src = fs.readFileSync(new URL('../app/api/chat/route.ts', import.meta.url), 'utf8');
  const post = src.slice(src.indexOf('export async function POST'));
  assert.ok(post.includes('brevoAttachmentField('), 'chat route must build attachments via brevoAttachmentField');
  assert.equal(/\battachment:\s*attachments/.test(post), false, 'no raw attachment array in chat payload');
  const send = post.indexOf("fetch('https://api.brevo.com/v3/smtp/email'");
  const log = post.indexOf('VALUES (${leadId}, ${channel}, ${desc}');
  assert.ok(send > 0 && log > 0 && send < log, 'Brevo send must happen before the sent activity is inserted');
});

test('ops route uses the helper for Brevo attachments', () => {
  const src = fs.readFileSync(new URL('../app/api/ops/comm/messages/route.ts', import.meta.url), 'utf8');
  assert.ok(src.includes('brevoAttachmentField('));
});
