import test from 'node:test';
import assert from 'node:assert/strict';
import * as c from '../lib/ops-vendor-mms-core.mjs';

// Minimal in-memory fake of the Neon tagged-template `sql` for the tables we touch.
function fakeDb(seed = {}) {
  const db = {
    threads: seed.threads || [],
    messages: seed.messages || [],
    attachments: [],
    links: [],
    vendorTouches: 0,
    queries: [],
  };
  let n = 0;
  const sql = async (strings, ...values) => {
    const q = strings.join('?').replace(/\s+/g, ' ').trim();
    db.queries.push({ q, values });
    if (q.startsWith('SELECT id FROM crm_comm_threads')) {
      return db.threads.filter((t) => t.vendor_id === values[0]).slice(0, 1);
    }
    if (q.startsWith('INSERT INTO crm_comm_threads')) {
      const t = { id: `thread-${++n}`, vendor_id: values[0] };
      db.threads.push(t);
      return [t];
    }
    if (q.startsWith('SELECT id FROM crm_comm_messages') && q.includes('external_message_id')) {
      return db.messages.filter((m) => m.thread_id === values[0] && m.external_message_id === values[1]).slice(0, 1);
    }
    if (q.startsWith('SELECT id FROM crm_comm_messages')) {
      return db.messages.filter((m) => m.thread_id === values[0] && m.body_text === values[1]).slice(0, 1);
    }
    if (q.startsWith('INSERT INTO crm_comm_messages')) {
      const m = { id: `msg-${++n}`, thread_id: values[0], actor_label: values[1], body_text: values[2], external_message_id: values[3] };
      db.messages.push(m);
      return [{ id: m.id }];
    }
    if (q.startsWith('UPDATE crm_comm_threads')) return [];
    if (q.startsWith('SELECT COUNT(*)::int AS count FROM crm_comm_message_attachments')) {
      return [{ count: db.links.filter((l) => l.message_id === values[0]).length }];
    }
    if (q.startsWith('INSERT INTO crm_attachments')) {
      const a = { id: 1000 + db.attachments.length, vendor_id: values[0], comm_message_id: values[1], file_name: values[2], mime_type: values[3], content_base64: values[4], size_bytes: values[5], crm_lead_id: null };
      db.attachments.push(a);
      return [{ id: a.id }];
    }
    if (q.startsWith('INSERT INTO crm_comm_message_attachments')) {
      db.links.push({ message_id: values[0], attachment_id: values[1] });
      return [];
    }
    if (q.startsWith('UPDATE crm_vendor_profiles')) { db.vendorTouches += 1; return []; }
    throw new Error('unexpected query: ' + q);
  };
  return { sql, db };
}

const vendor = { id: 'd153330c-6865-4526-9b8a-7960fb0248ec', display_name: 'Jaime', crm_profile: 'pnm_fencing' };
const jpeg = { fileName: 'sms-attachment-1.jpg', mimeType: 'image/jpeg', contentBase64: Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString('base64'), sizeBytes: 4 };

test('body text: text wins, media summary, failed media warning, legacy placeholder', () => {
  assert.equal(c.vendorInboundBodyText('  On my way ', 1), 'On my way');
  assert.equal(c.vendorInboundBodyText('', 1), '📎 1 attachment');
  assert.equal(c.vendorInboundBodyText('', 3), '📎 3 attachments');
  assert.match(c.vendorInboundBodyText('', 0, 2), /could not be retrieved from Twilio/);
  assert.equal(c.vendorInboundBodyText('', 0, 0), c.EMPTY_VENDOR_SMS_PLACEHOLDER);
});

test('vendor MMS saves media as a lead-less vendor attachment linked to the Ops message', async () => {
  const { sql, db } = fakeDb({ threads: [{ id: 'fed9d27c', vendor_id: vendor.id }] });
  const r = await c.saveVendorInboundSms(sql, { vendor, body: '', attachments: [jpeg], expectedMediaCount: 1, messageSid: 'MM123' });
  assert.equal(r.created, true);
  assert.equal(r.threadId, 'fed9d27c');
  assert.equal(db.messages.length, 1);
  assert.equal(db.messages[0].body_text, '📎 1 attachment');
  assert.equal(db.messages[0].external_message_id, 'MM123');
  assert.equal(db.attachments.length, 1);
  assert.equal(db.attachments[0].vendor_id, vendor.id);
  assert.equal(db.attachments[0].comm_message_id, r.messageId);
  assert.equal(db.attachments[0].crm_lead_id, null);
  assert.equal(db.attachments[0].mime_type, 'image/jpeg');
  assert.equal(db.attachments[0].content_base64, jpeg.contentBase64);
  assert.deepEqual(db.links, [{ message_id: r.messageId, attachment_id: db.attachments[0].id }]);
  assert.deepEqual(r.attachmentIds, [db.attachments[0].id]);
});

test('Twilio webhook retry with the same MessageSid does not duplicate the message or media', async () => {
  const { sql, db } = fakeDb({ threads: [{ id: 't1', vendor_id: vendor.id }] });
  await c.saveVendorInboundSms(sql, { vendor, body: '', attachments: [jpeg], messageSid: 'MM9' });
  const again = await c.saveVendorInboundSms(sql, { vendor, body: '', attachments: [jpeg], messageSid: 'MM9' });
  assert.equal(again.created, false);
  assert.equal(db.messages.length, 1);
  assert.equal(db.attachments.length, 1);
  assert.equal(db.links.length, 1);
});

test('two distinct empty MMS within minutes are both kept (dedupe by sid, not body)', async () => {
  const { sql, db } = fakeDb({ threads: [{ id: 't1', vendor_id: vendor.id }] });
  await c.saveVendorInboundSms(sql, { vendor, body: '', attachments: [jpeg], messageSid: 'MMa' });
  await c.saveVendorInboundSms(sql, { vendor, body: '', attachments: [jpeg], messageSid: 'MMb' });
  assert.equal(db.messages.length, 2);
  assert.equal(db.attachments.length, 2);
});

test('text-only vendor SMS path unchanged: no attachments, thread created if missing', async () => {
  const { sql, db } = fakeDb();
  const r = await c.saveVendorInboundSms(sql, { vendor, body: "I'm on my way", messageSid: 'SM1' });
  assert.equal(r.created, true);
  assert.equal(db.threads.length, 1);
  assert.equal(db.messages[0].body_text, "I'm on my way");
  assert.equal(db.attachments.length, 0);
  assert.equal(db.links.length, 0);
  assert.equal(db.vendorTouches, 1);
  assert.ok(!db.queries.some((x) => x.q.includes('crm_attachments')));
});

test('without a MessageSid falls back to legacy same-body dedupe', async () => {
  const { sql, db } = fakeDb({ threads: [{ id: 't1', vendor_id: vendor.id }] });
  await c.saveVendorInboundSms(sql, { vendor, body: 'Ok' });
  const again = await c.saveVendorInboundSms(sql, { vendor, body: 'Ok' });
  assert.equal(again.created, false);
  assert.equal(db.messages.length, 1);
});

test('groupMessageAttachments maps rows onto messages with view URLs', () => {
  const out = c.groupMessageAttachments(
    [{ id: 'a', body_text: 'x' }, { id: 'b', body_text: 'y' }],
    [{ message_id: 'b', id: 7, file_name: 'p.jpg', mime_type: 'image/jpeg', size_bytes: 10 }],
  );
  assert.deepEqual(out[0].attachments, []);
  assert.deepEqual(out[1].attachments, [{ id: 7, file_name: 'p.jpg', mime_type: 'image/jpeg', size_bytes: 10, url: '/api/crm-attachments/7' }]);
});
