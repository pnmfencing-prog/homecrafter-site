import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldRecordInbound, mediaCount, fetchMediaWithRetry, collectMedia } from '../lib/twilio-media-core.mjs';

const ok = (bytes = 'abc') => ({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(bytes).buffer });
const fail = (status) => ({ ok: false, status, arrayBuffer: async () => new ArrayBuffer(0) });
const noSleep = async () => {};
function seq(...responses) {
  const calls = [];
  const impl = async (url, init) => { calls.push({ url, init }); const r = responses.shift(); if (r instanceof Error) throw r; return r; };
  return { impl, calls };
}
const form = (o) => (k) => (k in o ? o[k] : null);

test('photo-only MMS whose download failed is still recorded (Gina 12305 case)', () => {
  assert.equal(shouldRecordInbound({ from: '+19085551234', body: '', attachmentCount: 0, expectedMediaCount: 1 }), true);
});
test('text, attachment, or nothing', () => {
  assert.equal(shouldRecordInbound({ from: '+1', body: 'hi', attachmentCount: 0, expectedMediaCount: 0 }), true);
  assert.equal(shouldRecordInbound({ from: '+1', body: '', attachmentCount: 1, expectedMediaCount: 1 }), true);
  assert.equal(shouldRecordInbound({ from: '+1', body: '   ', attachmentCount: 0, expectedMediaCount: 0 }), false);
  assert.equal(shouldRecordInbound({ from: '', body: 'hi', attachmentCount: 0, expectedMediaCount: 1 }), false);
});
test('mediaCount clamps and tolerates junk', () => {
  assert.equal(mediaCount('2'), 2); assert.equal(mediaCount('99'), 10); assert.equal(mediaCount(null), 0); assert.equal(mediaCount('x'), 0);
});
test('retries a transient 404 then succeeds', async () => {
  const s = seq(fail(404), ok('img'));
  const r = await fetchMediaWithRetry('u', { fetchImpl: s.impl, sleep: noSleep });
  assert.equal(r.attempts, 2); assert.equal(r.buf.toString(), 'img');
});
test('retries network error / 5xx up to 3 attempts, then gives up without throwing', async () => {
  const s = seq(new Error('reset'), fail(502), fail(503));
  const r = await fetchMediaWithRetry('u', { fetchImpl: s.impl, sleep: noSleep });
  assert.equal(r.buf, null); assert.equal(r.attempts, 3); assert.equal(r.status, 503);
});
test('401/403 are not retried', async () => {
  const s = seq(fail(401), ok());
  const r = await fetchMediaWithRetry('u', { fetchImpl: s.impl, sleep: noSleep });
  assert.equal(r.buf, null); assert.equal(r.attempts, 1); assert.equal(s.calls.length, 1);
});
test('respects the overall deadline', async () => {
  let t = 0; const now = () => t;
  const s = seq(fail(404), ok());
  const r = await fetchMediaWithRetry('u', { fetchImpl: s.impl, sleep: async (ms) => { t += ms; }, deadline: 500, now });
  assert.equal(r.buf, null); assert.equal(r.attempts, 1);
});
test('collectMedia keeps order, passes auth header, reports failures', async () => {
  const byUrl = { u0: [ok('A')], u1: [fail(404), fail(404), fail(404)], u2: [ok('C')] };
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push(init.headers.Authorization); return byUrl[url].shift(); };
  const logs = [];
  const r = await collectMedia(form({ NumMedia: '3', MediaUrl0: 'u0', MediaUrl1: 'u1', MediaUrl2: 'u2', MediaContentType0: 'image/jpeg', MediaContentType2: 'image/png' }),
    { authHeader: 'Basic xyz', extensionFromMime: (m) => m.split('/')[1], fetchImpl, sleep: noSleep, log: (m) => logs.push(m) });
  assert.deepEqual(r.attachments.map((a) => Buffer.from(a.contentBase64, 'base64').toString()), ['A', 'C']);
  assert.match(r.attachments[0].fileName, /-1\.jpeg$/); assert.match(r.attachments[1].fileName, /-3\.png$/);
  assert.deepEqual(r.failures, [{ index: 1, status: 404, attempts: 3 }]);
  assert.ok(seen.every((h) => h === 'Basic xyz'));
  assert.equal(logs.length, 1); assert.doesNotMatch(logs[0], /u1|Basic/);
});
test('no media -> no fetches', async () => {
  let called = false;
  const r = await collectMedia(form({ NumMedia: '0' }), { fetchImpl: async () => { called = true; } });
  assert.deepEqual(r, { attachments: [], failures: [] }); assert.equal(called, false);
});
