import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyOptOut } from '../lib/sms-optout-core.mjs';

test("Joseph Abbott 12419 exact text does NOT auto-lose", () => {
  const r = classifyOptOut('Good morning, I am good with price, can you send me the contract? I will pay full amount');
  assert.equal(r.kind, null);
  assert.equal(classifyOptOut('Good morning, I am good with price... I will pay full amount').kind, null);
});
test('plain "I\'m good, thanks" still counts as not-interested', () => {
  assert.equal(classifyOptOut("I'm good, thanks").kind, 'soft');
  assert.equal(classifyOptOut('No thanks').kind, 'soft');
  assert.equal(classifyOptOut('We are all set, thank you').kind, 'soft');
  assert.equal(classifyOptOut('not interested').kind, 'soft');
});
test('STOP and friends still opt out', () => {
  for (const s of ['STOP', 'stop', ' Unsubscribe ', 'END', 'quit']) assert.equal(classifyOptOut(s).kind, 'hard', s);
  assert.equal(classifyOptOut('wrong number').kind, 'strong');
  assert.equal(classifyOptOut('Please remove me from your list').kind, 'strong');
});
test('soft phrases with buying/scheduling context stay for a human', () => {
  for (const s of ["We're good to go, when can you install?", 'All set for Friday', "I'm good with the $4,096 option",
                   'No thanks on the wood, can you price vinyl', 'im good, lets schedule']) {
    assert.equal(classifyOptOut(s).kind, null, s);
  }
});
test('real declines from history still count (audit 10/22)', () => {
  for (const s of ["Thanks Dan but I think I'm good for now.", "Hello. I'm good for now. Thank you", 'No thank you not at this time',
                   "I'm not sure how you got my contact information, I'm not interested"]) {
    assert.equal(classifyOptOut(s).kind, 'soft', s);
  }
});
