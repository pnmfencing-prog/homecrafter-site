import test from 'node:test';
import assert from 'node:assert/strict';
import { CLOSE_LEAD_ON_SIGN_SQL, closeLeadParams, closeLeadOnSign, signSmsSuffix } from '../lib/proposal-sign-core.mjs';

const P = { estimate_no: '1300', crm_lead_id: 12325, crm_profile: 'pnm_fencing', total: '2742' };

test('SQL closes the lead: sold, campaign cleared, paused, activity row, single statement', () => {
  const s = CLOSE_LEAD_ON_SIGN_SQL;
  assert.match(s, /ELSE 'sold' END/);
  assert.match(s, /campaign_id = NULL/);
  assert.match(s, /outreach_paused = true/);
  assert.match(s, /'sold', 'won', 'scheduled', 'completed'/);
  assert.match(s, /INSERT INTO crm_activity/);
  assert.match(s, /'proposal_sign'/);
  assert.match(s, /COALESCE\(crm_profile, 'fencecrafters'\) = \$2::text/);
  assert.equal((s.replace(/'[^']*'/g, '').match(/;/g) || []).length, 0, 'one statement (no ; outside string literals)');
});
test('params: lead, profile, total, estimate, signer', () => {
  assert.deepEqual(closeLeadParams(P, 'Mario Autiero'), [12325, 'pnm_fencing', 2742, '1300', 'Mario Autiero']);
  assert.deepEqual(closeLeadParams({ ...P, crm_profile: null, total: null }, ''), [12325, null, null, '1300', 'customer']);
  assert.equal(closeLeadParams({ ...P, crm_lead_id: null }, 'x'), null);
  assert.equal(closeLeadParams({ ...P, crm_lead_id: 'abc' }, 'x'), null);
});
test('closeLeadOnSign runs the SQL and returns the row', async () => {
  const calls = [];
  const sql = { query: async (text, params) => { calls.push({ text, params }); return [{ id: 12325, prev_status: 'quoted', new_status: 'sold', prior_campaign_id: 4, activity_rows: 1 }]; } };
  const r = await closeLeadOnSign(sql, P, 'Mario Autiero');
  assert.equal(r.ok, true); assert.equal(r.row.new_status, 'sold');
  assert.equal(calls.length, 1); assert.equal(calls[0].text, CLOSE_LEAD_ON_SIGN_SQL);
  assert.equal(signSmsSuffix(r), ' — CRM: quoted → sold, campaign #4 stopped');
});
test('no lead -> skipped, no query', async () => {
  let called = false;
  const r = await closeLeadOnSign({ query: async () => { called = true; return []; } }, { ...P, crm_lead_id: null }, 'x');
  assert.deepEqual(r, { ok: true, skipped: 'no_crm_lead' }); assert.equal(called, false); assert.equal(signSmsSuffix(r), '');
});
test('profile mismatch / missing lead and DB errors never throw; Dan is told', async () => {
  const none = await closeLeadOnSign({ query: async () => [] }, P, 'x');
  assert.equal(none.ok, false); assert.match(signSmsSuffix(none), /NOT updated/);
  const boom = await closeLeadOnSign({ query: async () => { throw new Error('db down'); } }, P, 'x');
  assert.deepEqual(boom, { ok: false, error: 'db down' });
});
