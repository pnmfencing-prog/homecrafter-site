import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as c from '../lib/crm-update-core.mjs';

test('Sales Director 12323 repro body is rejected, not silently accepted', () => {
  const r = c.validateUpdateBody({ action: 'update', id: 12323, status: 'sold', campaign_id: null });
  assert.equal(r.ok, false);
  assert.equal(r.httpStatus, 400);
  assert.deepEqual(r.unsupported_fields.sort(), ['campaign_id', 'status']);
  assert.match(r.use.status, /update_status/);
  assert.match(r.use.campaign_id, /assign_lead/);
  assert.match(r.error, /Nothing was changed/);
});

test('status alone (Jennifer 11949 promising_reply) is rejected', () => {
  const r = c.validateUpdateBody({ action: 'update', id: '11949', status: 'promising_reply' });
  assert.equal(r.ok, false);
  assert.deepEqual(r.unsupported_fields, ['status']);
});

test('mixed valid + unsupported fields rejects whole request (no partial write)', () => {
  const r = c.validateUpdateBody({ action: 'update', id: 5, notes: 'x', campaign_id: 13 });
  assert.equal(r.ok, false);
  assert.deepEqual(r.unsupported_fields, ['campaign_id']);
});

test('unknown typo key is rejected', () => {
  const r = c.validateUpdateBody({ action: 'update', id: 5, next_followup: '2027-02-14' });
  assert.equal(r.ok, false);
  assert.deepEqual(r.unsupported_fields, ['next_followup']);
});

test('existing UI/agent bodies still pass', () => {
  const ok = [
    { action: 'update', id: 1, customer_email: 'a@b.co' },
    { action: 'update', id: 1, quoted_amount: null, job_value: '100' },
    { action: 'update', id: 1, notes: null },
    { action: 'update', id: 1, install_start: '2026-11-01' },
    { action: 'update', id: 1, profile: 'lowes_fencing', crm_profile: 'lowes_fencing', next_follow_up: '2027-02-14T15:00:00Z' },
    { action: 'update', id: 1, quoted_amount: 6700, crm_profile: 'lowes_fencing' },
    { action: 'update', id: 1, customer_name: 'n', customer_phone: 'p', customer_email: null, service_type: null,
      customer_address: null, customer_city: null, customer_state: null, customer_zip: null },
  ];
  for (const b of ok) {
    const r = c.validateUpdateBody(b);
    assert.equal(r.ok, true, JSON.stringify(b) + ' -> ' + JSON.stringify(r));
  }
  assert.deepEqual(c.validateUpdateBody({ action: 'update', id: 1, notes: null }).fields, ['notes']);
});

test('no updatable fields / bad id are errors', () => {
  assert.equal(c.validateUpdateBody({ action: 'update', id: 1 }).ok, false);
  assert.equal(c.validateUpdateBody({ action: 'update', id: 1, crm_profile: 'pnm_fencing' }).ok, false);
  assert.equal(c.validateUpdateBody({ action: 'update', notes: 'x' }).ok, false);
  assert.equal(c.validateUpdateBody({ action: 'update', id: 0, notes: 'x' }).ok, false);
  assert.equal(c.validateUpdateBody({ action: 'update', id: 'abc', notes: 'x' }).ok, false);
  assert.equal(c.validateUpdateBody(null).ok, false);
});

test('update_status validation', () => {
  assert.deepEqual(c.validateStatusBody({ id: '12323', status: ' sold ' }), { ok: true, id: 12323, status: 'sold' });
  assert.equal(c.validateStatusBody({ id: 1 }).ok, false);
  assert.equal(c.validateStatusBody({ id: 1, status: '' }).ok, false);
  assert.equal(c.validateStatusBody({ status: 'sold' }).ok, false);
});

test('persistedMismatches catches silent trigger reverts and missing rows', () => {
  assert.deepEqual(c.persistedMismatches({ status: 'sold' }, { status: 'sold' }), []);
  assert.deepEqual(c.persistedMismatches({ campaign_id: 13 }, { campaign_id: '13' }), []);
  assert.deepEqual(c.persistedMismatches({ campaign_id: null }, { campaign_id: null }), []);
  // MSG RCVD trigger keeps outreach_paused=true when we asked for false
  assert.deepEqual(c.persistedMismatches({ outreach_paused: false }, { outreach_paused: true }), ['outreach_paused']);
  assert.deepEqual(c.persistedMismatches({ status: 'sold' }, undefined), ['*row*']);
});

// Static guards on the route source so the silent-success pattern can't come back.
const crmRoute = fs.readFileSync(new URL('../app/api/crm/route.ts', import.meta.url), 'utf8');
const campRoute = fs.readFileSync(new URL('../app/api/campaigns/route.ts', import.meta.url), 'utf8');
function block(src, start, end) {
  const i = src.indexOf(start); const j = src.indexOf(end, i + start.length);
  assert.ok(i >= 0 && j > i, `block ${start}`); return src.slice(i, j);
}

test('route: action=update validates before writing and checks every UPDATE', () => {
  const b = block(crmRoute, "if (action === 'update') {", "if (action === 'add_note') {");
  const v = b.indexOf('validateUpdateBody(');
  const firstUpdate = b.indexOf('UPDATE crm_leads');
  assert.ok(v >= 0 && v < firstUpdate, 'validateUpdateBody must run before any UPDATE');
  const updates = b.match(/UPDATE crm_leads[\s\S]*?`/g) || [];
  assert.ok(updates.length >= 17, 'expected per-field updates');
  for (const u of updates) assert.match(u, /RETURNING/, 'every crm_leads UPDATE in action=update needs RETURNING: ' + u.slice(0, 80));
  assert.match(b, /Lead not found/);
});

test('route: update_status verifies persisted status', () => {
  const b = block(crmRoute, "if (action === 'update_status') {", "if (action === 'update') {");
  assert.match(b, /validateStatusBody\(/);
  assert.match(b, /SET status = \$\{status\}, updated_at = NOW\(\) WHERE id = \$\{id\}\s*RETURNING status/);
  assert.match(b, /status: 409/);
});

test('route: assign_lead checks rowcount and reports MSG RCVD hold', () => {
  const b = block(campRoute, "if (action === 'assign_lead') {", "if (action === 'bulk_assign') {");
  const updates = b.match(/UPDATE crm_leads[\s\S]*?`/g) || [];
  assert.ok(updates.length >= 2);
  for (const u of updates) assert.match(u, /RETURNING/);
  assert.match(b, /msg_rcvd_hold/);
});
