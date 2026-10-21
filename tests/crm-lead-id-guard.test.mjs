import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as c from '../lib/crm-update-core.mjs';

test('Sales Director repro: add_note with lead_id resolves to that lead', () => {
  assert.deepEqual(c.resolveLeadIdBody({ action: 'add_note', lead_id: 12329, description: 'x' }), { ok: true, id: 12329 });
  assert.deepEqual(c.resolveLeadIdBody({ action: 'add_note', crm_lead_id: '12329' }), { ok: true, id: 12329 });
  assert.deepEqual(c.resolveLeadIdBody({ action: 'add_note', id: 12329, lead_id: 12329 }), { ok: true, id: 12329 });
});

test('missing / invalid / conflicting id -> 400, nothing saved', () => {
  for (const b of [{ action: 'add_note' }, { action: 'add_note', id: null }, { action: 'add_note', id: '' },
                   { action: 'add_note', lead_id: 'abc' }, { action: 'add_note', id: 0 }, { action: 'add_note', id: 1, lead_id: 2 }]) {
    const r = c.resolveLeadIdBody(b);
    assert.equal(r.ok, false, JSON.stringify(b)); assert.equal(r.httpStatus, 400); assert.match(r.error, /Nothing was saved/);
  }
});

test('route guards add_note/toggle_flag/toggle_read before any insert, with existence check', () => {
  assert.deepEqual([...c.LEAD_WRITE_ACTIONS], ['add_note', 'toggle_flag', 'toggle_read']);
  const src = fs.readFileSync(new URL('../app/api/crm/route.ts', import.meta.url), 'utf8');
  const post = src.slice(src.indexOf('export async function POST'));
  const guard = post.indexOf('resolveLeadIdBody(body)');
  assert.ok(guard > 0 && guard < post.indexOf("action === 'find_or_create'"));
  assert.match(post, /Lead \$\{lr\.id\} not found\. Nothing was saved\./);
  assert.match(post, /body\.id = lr\.id;/);
});
