// Proposal signed -> CRM lead closed (2026-10-20, PNM #1300 / Mario Autiero 12325).
// Bug: POST /api/proposals/sign only updated `proposals` and texted Dan; the CRM
// lead stayed quoted on Quote FU and kept getting campaign texts after signing.
// Fix: on sign, in ONE statement (atomic): status -> sold (unless already
// sold/won/scheduled/completed), campaign_id -> NULL, outreach_paused -> true,
// job_value defaults to the proposal total, plus a status_change activity row.

export const CLOSED_STATUSES = Object.freeze(['sold', 'won', 'scheduled', 'completed']);

/**
 * $1 lead id (int), $2 lead profile or NULL (only touch the lead when its profile
 * matches the proposal's, so a PNM/FC twin is never closed by mistake),
 * $3 proposal total (numeric or NULL), $4 estimate_no, $5 signer name.
 */
export const CLOSE_LEAD_ON_SIGN_SQL = `
WITH prior AS (
  SELECT id, status, campaign_id
  FROM crm_leads
  WHERE id = $1::int
    AND ($2::text IS NULL OR COALESCE(crm_profile, 'fencecrafters') = $2::text)
  FOR UPDATE
), upd AS (
  UPDATE crm_leads l
  SET status = CASE WHEN lower(COALESCE(l.status, '')) IN ('sold', 'won', 'scheduled', 'completed') THEN l.status ELSE 'sold' END,
      campaign_id = NULL,
      outreach_paused = true,
      job_value = COALESCE(l.job_value, $3::numeric),
      updated_at = NOW()
  FROM prior
  WHERE l.id = prior.id
  RETURNING l.id, prior.status AS prev_status, l.status AS new_status, prior.campaign_id AS prior_campaign_id
), act AS (
  INSERT INTO crm_activity (crm_lead_id, activity_type, description, is_from_customer, created_by)
  SELECT id, 'status_change',
         'Proposal #' || $4::text || ' signed by ' || $5::text
         || CASE WHEN prev_status IS DISTINCT FROM new_status
                 THEN ': ' || COALESCE(prev_status, '(none)') || ' → ' || new_status
                 ELSE ' (status kept ' || new_status || ')' END
         || CASE WHEN prior_campaign_id IS NOT NULL THEN '; campaign #' || prior_campaign_id || ' cleared' ELSE '' END,
         false, 'proposal_sign'
  FROM upd
  RETURNING id
)
SELECT u.id, u.prev_status, u.new_status, u.prior_campaign_id, (SELECT count(*) FROM act)::int AS activity_rows
FROM upd u
`;

/** Build params for CLOSE_LEAD_ON_SIGN_SQL, or null when the proposal has no CRM lead. */
export function closeLeadParams(proposal, signerName, normalizeProfile = (p) => p) {
  const leadId = Number(proposal?.crm_lead_id);
  if (!Number.isInteger(leadId) || leadId <= 0) return null;
  const profile = proposal?.crm_profile ? normalizeProfile(proposal.crm_profile) : null;
  const total = proposal?.total === null || proposal?.total === undefined || proposal?.total === '' ? null : Number(proposal.total);
  return [
    leadId,
    profile || null,
    Number.isFinite(total) ? total : null,
    String(proposal?.estimate_no ?? ''),
    String(signerName || 'customer').slice(0, 120),
  ];
}

/**
 * Close the CRM lead for a signed proposal. Never throws: the signature is
 * already saved, so a CRM failure is reported to the caller (Dan's SMS) instead.
 * Returns {ok, skipped?, row?, error?}.
 */
export async function closeLeadOnSign(sql, proposal, signerName, normalizeProfile) {
  const params = closeLeadParams(proposal, signerName, normalizeProfile);
  if (!params) return { ok: true, skipped: 'no_crm_lead' };
  try {
    const rows = await sql.query(CLOSE_LEAD_ON_SIGN_SQL, params);
    const row = (Array.isArray(rows) ? rows : rows?.rows || [])[0];
    if (!row) return { ok: false, error: 'lead_not_found_or_profile_mismatch' };
    return { ok: true, row };
  } catch (err) {
    return { ok: false, error: String(err?.message || err).slice(0, 200) };
  }
}

/** One-line suffix for Dan's "Proposal signed" SMS. */
export function signSmsSuffix(result) {
  if (!result || result.skipped) return '';
  if (!result.ok) return ` — ⚠️ CRM lead NOT updated (${result.error}); set sold + remove campaign by hand`;
  const r = result.row;
  return ` — CRM: ${r.prev_status || '(none)'} → ${r.new_status}${r.prior_campaign_id ? `, campaign #${r.prior_campaign_id} stopped` : ''}`;
}
