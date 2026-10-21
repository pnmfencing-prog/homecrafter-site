// Pure validation for POST /api/crm action=update / update_status.
// Bug 2026-10-20: action=update silently ignored `status` / `campaign_id` (and any
// other unknown key) and still returned {success:true}. Unknown keys are now rejected
// BEFORE any write, so callers never get a partial update reported as success.

/** Columns action=update may write (one UPDATE per present key). */
export const UPDATE_FIELDS = Object.freeze([
  'quoted_amount', 'job_value', 'assigned_to', 'next_follow_up', 'notes', 'service_type',
  'customer_email', 'customer_phone', 'customer_name', 'customer_address', 'customer_city',
  'customer_state', 'customer_zip', 'twister_work_order', 'lowes_store', 'source', 'install_start',
]);

/** Keys callers send for routing/context; accepted and ignored. */
export const UPDATE_PASSTHROUGH_KEYS = Object.freeze(['action', 'id', 'profile', 'crm_profile']);

/** Fields that belong to another action; tell the caller where to send them. */
export const REDIRECTED_FIELDS = Object.freeze({
  status: 'POST /api/crm {action:"update_status", id, status, lost_reason?}',
  lost_reason: 'POST /api/crm {action:"update_status", id, status:"lost", lost_reason}',
  campaign_id: 'POST /api/campaigns?profile=<crm_profile> {action:"assign_lead", lead_id, campaign_id|null, crm_profile}',
  campaign_started_at: 'POST /api/campaigns {action:"assign_lead", ...}',
  outreach_paused: 'POST /api/campaigns {action:"assign_lead", ...} (MSG RCVD hold may keep it paused)',
  customer_responded: 'POST /api/campaigns {action:"assign_lead", ...} (MSG RCVD hold may keep it set)',
  is_read: 'POST /api/crm {action:"toggle_read", id, is_read}',
  flagged: 'POST /api/crm {action:"toggle_flag", id, flagged}',
});

export function parseLeadId(raw) {
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Validate an action=update body.
 * @returns {{ok:true,id:number,fields:string[]} | {ok:false,httpStatus:number,error:string,unsupported_fields?:string[],use?:object}}
 */
export function validateUpdateBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, httpStatus: 400, error: 'Body must be a JSON object' };
  }
  const id = parseLeadId(body.id);
  if (!id) return { ok: false, httpStatus: 400, error: 'Lead id required (positive integer)' };

  const keys = Object.keys(body);
  const unsupported = keys.filter((k) => !UPDATE_FIELDS.includes(k) && !UPDATE_PASSTHROUGH_KEYS.includes(k));
  if (unsupported.length) {
    const use = {};
    for (const k of unsupported) if (REDIRECTED_FIELDS[k]) use[k] = REDIRECTED_FIELDS[k];
    return {
      ok: false,
      httpStatus: 400,
      error: `action=update does not support: ${unsupported.join(', ')}. Nothing was changed.`,
      unsupported_fields: unsupported,
      use,
    };
  }
  const fields = UPDATE_FIELDS.filter((k) => body[k] !== undefined);
  if (!fields.length) {
    return { ok: false, httpStatus: 400, error: 'No updatable fields in request. Nothing was changed.' };
  }
  return { ok: true, id, fields };
}

/** Validate an action=update_status body. */
export function validateStatusBody(body) {
  const id = parseLeadId(body?.id);
  if (!id) return { ok: false, httpStatus: 400, error: 'Lead id required (positive integer)' };
  const status = typeof body?.status === 'string' ? body.status.trim() : '';
  if (!status) return { ok: false, httpStatus: 400, error: 'status required (non-empty string)' };
  if (status.length > 50) return { ok: false, httpStatus: 400, error: 'status too long' };
  return { ok: true, id, status };
}

/**
 * Compare what we asked the DB to persist with what RETURNING says was persisted.
 * A BEFORE trigger can rewrite NEW silently; this turns that into a visible mismatch list.
 * @param {Record<string, unknown>} requested
 * @param {Record<string, unknown>|undefined|null} persistedRow
 * @returns {string[]} field names whose persisted value differs (or ['*row*'] if no row)
 */
export function persistedMismatches(requested, persistedRow) {
  if (!persistedRow) return ['*row*'];
  const out = [];
  for (const [k, want] of Object.entries(requested)) {
    const got = persistedRow[k];
    const norm = (v) => (v === undefined ? null : v);
    if (norm(want) === null || norm(got) === null) {
      if (norm(want) !== norm(got)) out.push(k);
    } else if (String(want) !== String(got)) {
      out.push(k);
    }
  }
  return out;
}


// 2026-10-21: action=add_note accepted `lead_id` (ignored), inserted crm_activity with
// crm_lead_id NULL (orphan) and returned success. Lead-scoped write actions now resolve
// id from `id` | `lead_id` | `crm_lead_id` and must name an existing lead (route checks).
export const LEAD_WRITE_ACTIONS = Object.freeze(['add_note', 'toggle_flag', 'toggle_read']);
export const LEAD_ID_ALIASES = Object.freeze(['id', 'lead_id', 'crm_lead_id']);

/**
 * @returns {{ok:true,id:number} | {ok:false,httpStatus:number,error:string}}
 */
export function resolveLeadIdBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, httpStatus: 400, error: 'Body must be a JSON object' };
  }
  const given = LEAD_ID_ALIASES.filter((k) => body[k] !== undefined && body[k] !== null && body[k] !== '');
  if (!given.length) {
    return { ok: false, httpStatus: 400, error: 'Missing lead id: send `id` (or `lead_id` / `crm_lead_id`). Nothing was saved.' };
  }
  const ids = given.map((k) => parseLeadId(body[k]));
  if (ids.some((n) => n === null)) {
    return { ok: false, httpStatus: 400, error: `Invalid lead id (${given.map((k) => `${k}=${JSON.stringify(body[k])}`).join(', ')}). Nothing was saved.` };
  }
  if (new Set(ids).size > 1) {
    return { ok: false, httpStatus: 400, error: `Conflicting lead ids (${given.map((k, i) => `${k}=${ids[i]}`).join(', ')}). Nothing was saved.` };
  }
  return { ok: true, id: ids[0] };
}


// 2026-10-21 (Dan): installs are always a morning/afternoon slot. Date-only install_start
// values ("2026-10-22") were stored by Postgres as midnight UTC and pushed to Twister as
// 8:00 PM ET the day before. A date-only value, midnight UTC, or midnight ET now means
// THAT calendar date at 8:00 AM ET. Any other explicit time is kept as sent.
function eightAmEtIso(y, m, d) {
  // 8 AM EDT = 12:00Z, 8 AM EST = 13:00Z; pick the one that reads 08 in New York.
  for (const utcHour of [12, 13]) {
    const t = new Date(Date.UTC(y, m - 1, d, utcHour, 0, 0));
    const h = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hour12: false }).format(t);
    if (Number(h) === 8) return t.toISOString();
  }
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).toISOString();
}

export function normalizeInstallStart(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const s = String(raw).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return eightAmEtIso(+m[1], +m[2], +m[3]);
  // no zone, midnight -> date-only intent
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ]00:00(:00(\.0+)?)?$/);
  if (m) return eightAmEtIso(+m[1], +m[2], +m[3]);
  // midnight UTC
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ]00:00(:00(\.0+)?)?(Z|[+-]00(:?00)?)$/i);
  if (m) return eightAmEtIso(+m[1], +m[2], +m[3]);
  const t = new Date(s);
  if (Number.isNaN(t.getTime())) return s; // let the DB reject garbage as before
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(t).map((x) => [x.type, x.value]));
  if (p.hour === '00' && p.minute === '00' && p.second === '00') return eightAmEtIso(+p.year, +p.month, +p.day);
  if (t.getUTCHours() === 0 && t.getUTCMinutes() === 0 && t.getUTCSeconds() === 0) {
    return eightAmEtIso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }
  return s;
}
