// 2026-10-22 optout fix (Joseph Abbott 12419: "Good morning, I am good with price... I will pay full amount"
// was auto-LOST because "i am good" matched). Pure classifier, shared by /api/sms/inbound and tests.
// hard   = carrier opt-out keywords (unchanged; compliance)
// strong = explicit remove/hostile/wrong-number requests (unchanged)
// soft   = "I'm good" / "all set" / "no thanks" / "not interested": only when the message is short and has
//          NO acceptance, price, scheduling or buying context. When unsure -> null (stays MSG RCVD for a human).
export const HARD_OPTOUT_RE = /^(stop|stopall|unsubscribe|cancel|end|quit)$/i;
export const STRONG_NEGATIVE_RE = /\b(fuck off|f off|leave me alone|do not text|dont text|don't text|remove me|wrong number)\b/i;
export const SOFT_NOT_INTERESTED_RE = /\b(not interested|no thanks?|no thank you|i'?m good|im good|i am good|all set|we'?re good|were good|we are good)\b/i;
// "I'm good with the price", "all set for Friday", "we're good to go" are acceptance, not a no.
export const SOFT_POSITIVE_TAIL_RE = /\b(?:i'?m|im|i am|we'?re|were|we are|all)\s+(?:good|set)\s+(?:with|on|to go|about|by|w\/|for (?!now\b|the moment\b|this year\b)\w)/i;
export const BUYING_CONTEXT_RE = /\b(price|prices|pricing|priced|quote|quoted|estimate|cost|costs|pay|paying|paid|payment|deposit|full amount|invoice|venmo|zelle|card|schedul\w*|install\w*|appointment|appt|available|availability|when can|when do|when would|what date|what day|what time|best time|tomorrow|today|tonight|next week|this week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|sign|signed|contract|proposal|proceed|go ahead|move forward|book|yes|yeah|yep|ok|okay|sure thing|for sure|sounds good|deal|accept\w*|approv\w*|ready|order|measure\w*|survey|call me|give me a call|start|begin|question|questions)\b/i;
export const SOFT_MAX_WORDS = 20;

export function classifyOptOut(body) {
  const text = String(body || '').trim();
  if (!text) return { kind: null, phrase: null };
  if (HARD_OPTOUT_RE.test(text)) return { kind: 'hard', phrase: text.toLowerCase() };
  const strong = text.match(STRONG_NEGATIVE_RE);
  if (strong) return { kind: 'strong', phrase: strong[0].toLowerCase() };
  const soft = text.match(SOFT_NOT_INTERESTED_RE);
  if (!soft) return { kind: null, phrase: null };
  const phrase = soft[0].toLowerCase();
  let why = null;
  if (SOFT_POSITIVE_TAIL_RE.test(text)) why = 'acceptance wording ("good with/for/to ...")';
  else if (/[$\d]/.test(text)) why = 'contains a number or price';
  else if (text.includes('?')) why = 'asks a question';
  else if (BUYING_CONTEXT_RE.test(text)) why = 'price/scheduling/buying context';
  else if (text.split(/\s+/).length > SOFT_MAX_WORDS) why = `longer than ${SOFT_MAX_WORDS} words`;
  if (why) return { kind: null, phrase, held: why };
  return { kind: 'soft', phrase };
}
