import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeInstallStart as n } from '../lib/crm-update-core.mjs';

test('10/22 00:00Z -> Thu 10/22 8:00 AM ET', () => {
  const v = n('2026-10-22T00:00:00Z');
  assert.equal(v, '2026-10-22T12:00:00.000Z');
  assert.equal(new Date(v).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric' }), 'Thu, 8 AM');
});
test('date-only and midnight forms -> 8 AM ET same date', () => {
  for (const s of ['2026-10-22', '2026-10-22T00:00', '2026-10-22 00:00:00', '2026-10-22T00:00:00.000Z', '2026-10-22T00:00:00+00:00', '2026-10-22T04:00:00.000Z', '2026-10-22T00:00:00-04:00']) {
    assert.equal(n(s), '2026-10-22T12:00:00.000Z', s);
  }
});
test('winter (EST) 8 AM = 13:00Z', () => assert.equal(n('2027-01-15'), '2027-01-15T13:00:00.000Z'));
test('explicit times kept; null/empty clear', () => {
  assert.equal(n('2026-10-23T12:00:00Z'), '2026-10-23T12:00:00Z');
  assert.equal(n('2026-10-23T17:30:00.000Z'), '2026-10-23T17:30:00.000Z');
  assert.equal(n(null), null); assert.equal(n(''), null);
});
