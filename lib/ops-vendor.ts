import sql from '@/lib/db';
import { normalizeCrmProfile } from '@/lib/email-policy';
import { previewText } from '@/lib/crm-admin';

/** Last-10 phone digits for matching leads ↔ Ops vendors across formatting. */
export function phoneDigits10(phone: unknown): string {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) return d.slice(1);
  if (d.length > 10) return d.slice(-10);
  return d;
}

export function isOpsVendorLeadStatus(status: unknown): boolean {
  return String(status || '') === 'ops_vendor_not_customer';
}

export const OPS_VENDOR_STATUS = 'ops_vendor_not_customer' as const;

/** Active Ops vendor matching phone; prefer crm_profile twin when provided. */
export async function findActiveVendorByPhone(
  phone: unknown,
  preferredProfile?: string | null,
): Promise<any | null> {
  const normalized = phoneDigits10(phone);
  if (normalized.length !== 10) return null;
  const preferred = preferredProfile ? normalizeCrmProfile(preferredProfile) : null;
  const matches = await sql`
    SELECT id, display_name, company, primary_phone, primary_email, crm_profile, profile_type, status
    FROM crm_vendor_profiles
    WHERE status <> 'archived'
      AND right(regexp_replace(coalesce(primary_phone, ''), '[^0-9]', '', 'g'), 10) = ${normalized}
    ORDER BY
      CASE WHEN ${preferred}::text IS NOT NULL AND crm_profile = ${preferred} THEN 0 ELSE 1 END,
      last_activity_at DESC NULLS LAST,
      updated_at DESC
    LIMIT 1
  `;
  return matches[0] || null;
}

/** All active vendor last-10 phones — hide vendor-mirrored sales leads. */
export async function loadActiveVendorPhoneDigits(): Promise<Set<string>> {
  const rows = await sql`
    SELECT primary_phone
    FROM crm_vendor_profiles
    WHERE status <> 'archived'
      AND primary_phone IS NOT NULL
      AND primary_phone <> ''
  `;
  const set = new Set<string>();
  for (const row of rows) {
    const d = phoneDigits10(row.primary_phone);
    if (d.length === 10) set.add(d);
  }
  return set;
}

/**
 * Append an outbound staff SMS onto the vendor's Operations SMS thread (crm_comm_*).
 * Dedupes by external_message_id (Twilio SID) when provided.
 */
export async function appendVendorOutboundSms(opts: {
  vendor: { id: string; display_name?: string | null };
  bodyText: string;
  externalMessageId?: string | null;
  actorLabel?: string | null;
  sentAt?: string | Date | null;
}): Promise<{ threadId: string; messageId: string; created: boolean }> {
  const bodyText = String(opts.bodyText || '').trim();
  if (!bodyText) throw new Error('SMS body is missing');
  const vendorId = String(opts.vendor.id);
  const actorLabel = String(opts.actorLabel || 'staff').trim() || 'staff';
  const externalId = opts.externalMessageId ? String(opts.externalMessageId) : null;
  const preview = previewText(bodyText);

  const existing = await sql`
    SELECT id FROM crm_comm_threads
    WHERE vendor_id = ${vendorId}::uuid
      AND channel = 'sms'
      AND title = 'SMS'
    ORDER BY updated_at DESC
    LIMIT 1
  `;
  let threadId = existing[0]?.id as string | undefined;
  if (!threadId) {
    const created = await sql`
      INSERT INTO crm_comm_threads (vendor_id, channel, title)
      VALUES (${vendorId}::uuid, 'sms', 'SMS')
      RETURNING id
    `;
    threadId = created[0].id;
  }

  if (externalId) {
    const dup = await sql`
      SELECT id FROM crm_comm_messages
      WHERE thread_id = ${threadId}::uuid
        AND external_message_id = ${externalId}
      LIMIT 1
    `;
    if (dup.length) {
      return { threadId: threadId!, messageId: String(dup[0].id), created: false };
    }
  } else {
    const softDup = await sql`
      SELECT id FROM crm_comm_messages
      WHERE thread_id = ${threadId}::uuid
        AND actor_type = 'staff'
        AND direction = 'outbound'
        AND body_text = ${bodyText}
        AND created_at > NOW() - INTERVAL '10 minutes'
      LIMIT 1
    `;
    if (softDup.length) {
      return { threadId: threadId!, messageId: String(softDup[0].id), created: false };
    }
  }

  const sentAt = opts.sentAt ? new Date(opts.sentAt) : null;
  const useCustomTime = !!(sentAt && !Number.isNaN(sentAt.getTime()));

  const messageRows = useCustomTime
    ? await sql`
        INSERT INTO crm_comm_messages (
          thread_id, actor_type, actor_label, body_text, message_kind,
          direction, delivery_status, external_message_id, created_at
        ) VALUES (
          ${threadId}::uuid,
          'staff',
          ${actorLabel},
          ${bodyText},
          'chat',
          'outbound',
          'sent',
          ${externalId},
          ${sentAt!.toISOString()}::timestamptz
        )
        RETURNING id
      `
    : await sql`
        INSERT INTO crm_comm_messages (
          thread_id, actor_type, actor_label, body_text, message_kind,
          direction, delivery_status, external_message_id
        ) VALUES (
          ${threadId}::uuid,
          'staff',
          ${actorLabel},
          ${bodyText},
          'chat',
          'outbound',
          'sent',
          ${externalId}
        )
        RETURNING id
      `;

  if (useCustomTime) {
    await sql`
      UPDATE crm_comm_threads
      SET
        last_message_preview = ${preview},
        last_message_at = GREATEST(coalesce(last_message_at, 'epoch'::timestamptz), ${sentAt!.toISOString()}::timestamptz),
        updated_at = NOW()
      WHERE id = ${threadId}::uuid
    `;
  } else {
    await sql`
      UPDATE crm_comm_threads
      SET
        last_message_preview = ${preview},
        last_message_at = NOW(),
        updated_at = NOW()
      WHERE id = ${threadId}::uuid
    `;
  }

  await sql`
    UPDATE crm_vendor_profiles
    SET last_activity_at = NOW(), updated_at = NOW()
    WHERE id = ${vendorId}::uuid
  `;

  return { threadId: threadId!, messageId: String(messageRows[0].id), created: true };
}

/** Soft-archive a sales lead that is really an Ops vendor contact (keep history). */
export async function markLeadAsOpsVendorNotCustomer(
  leadId: number | string,
  note?: string,
): Promise<void> {
  const id = Number(leadId);
  if (!Number.isFinite(id)) return;
  const desc =
    note ||
    'Closed as ops_vendor_not_customer — Operations vendor / GC partner, not a sales customer. Communication stays on Operations.';
  await sql`
    UPDATE crm_leads
    SET
      status = 'ops_vendor_not_customer',
      lost_reason = COALESCE(lost_reason, 'Ops vendor — not a sales customer'),
      outreach_paused = true,
      updated_at = NOW()
    WHERE id = ${id}
      AND status IS DISTINCT FROM 'ops_vendor_not_customer'
  `;
  await sql`
    INSERT INTO crm_activity (crm_lead_id, activity_type, description, is_from_customer, created_by)
    SELECT ${id}, 'status_change', ${desc}, false, 'system'
    WHERE NOT EXISTS (
      SELECT 1 FROM crm_activity a
      WHERE a.crm_lead_id = ${id}
        AND a.activity_type = 'status_change'
        AND a.description LIKE '%ops_vendor_not_customer%'
        AND a.created_at > NOW() - INTERVAL '7 days'
    )
  `;
}
