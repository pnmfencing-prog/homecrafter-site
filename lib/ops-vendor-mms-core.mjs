// Ops vendor inbound SMS/MMS persistence (pure + db-injected so it is unit-testable).
// Used by app/api/sms/inbound/route.ts for every CRM profile (PNM / FC / Lowes).
// Media is stored the same way lead MMS is: a crm_attachments row (base64), here
// lead-less with vendor_id + comm_message_id, linked via crm_comm_message_attachments.

export const EMPTY_VENDOR_SMS_PLACEHOLDER = '[attachment / empty inbound SMS]';

/** Body text stored on the Ops message row. */
export function vendorInboundBodyText(body, attachmentCount = 0, expectedMediaCount = 0) {
  const raw = String(body || '').trim();
  if (raw) return raw;
  if (attachmentCount > 0) return `📎 ${attachmentCount} attachment${attachmentCount === 1 ? '' : 's'}`;
  if (expectedMediaCount > 0) {
    return `⚠️ Vendor sent ${expectedMediaCount} media attachment${expectedMediaCount === 1 ? '' : 's'}, but the file${expectedMediaCount === 1 ? '' : 's'} could not be retrieved from Twilio.`;
  }
  return EMPTY_VENDOR_SMS_PLACEHOLDER;
}

/**
 * Append an inbound vendor SMS/MMS to the vendor's Ops SMS thread and save its media.
 * `sql` is a Neon-style tagged template returning rows.
 * Dedupe: by Twilio MessageSid when present (webhook retries + safety-net poller), else
 * the legacy same-body-within-10-minutes check.
 */
export async function saveVendorInboundSms(sql, opts) {
  const vendor = opts.vendor;
  const attachments = Array.isArray(opts.attachments) ? opts.attachments : [];
  const messageSid = opts.messageSid ? String(opts.messageSid) : null;
  const carrierNoise = !!opts.carrierNoise;
  const bodyText = vendorInboundBodyText(opts.body, attachments.length, Number(opts.expectedMediaCount || 0));
  const preview = bodyText.slice(0, 240);
  const actorLabel = opts.actorLabel || vendor.display_name || 'Vendor';

  const existing = await sql`
    SELECT id FROM crm_comm_threads
    WHERE vendor_id = ${vendor.id}::uuid
      AND channel = 'sms'
      AND title = 'SMS'
    ORDER BY updated_at DESC
    LIMIT 1
  `;
  let threadId = existing[0]?.id;
  if (!threadId) {
    const created = await sql`
      INSERT INTO crm_comm_threads (vendor_id, channel, title)
      VALUES (${vendor.id}::uuid, 'sms', 'SMS')
      RETURNING id
    `;
    threadId = created[0].id;
  }

  const duplicate = messageSid
    ? await sql`
      SELECT id FROM crm_comm_messages
      WHERE thread_id = ${threadId}::uuid
        AND external_message_id = ${messageSid}
      LIMIT 1
    `
    : await sql`
      SELECT id FROM crm_comm_messages
      WHERE thread_id = ${threadId}::uuid
        AND actor_type = 'vendor'
        AND direction = 'inbound'
        AND body_text = ${bodyText}
        AND created_at > NOW() - INTERVAL '10 minutes'
      LIMIT 1
    `;

  let messageId = duplicate[0]?.id || null;
  let created = false;
  if (!messageId) {
    const inserted = await sql`
      INSERT INTO crm_comm_messages (
        thread_id, actor_type, actor_label, body_text, message_kind, direction, external_message_id
      ) VALUES (
        ${threadId}::uuid, 'vendor', ${actorLabel}, ${bodyText}, 'chat', 'inbound', ${messageSid}
      )
      RETURNING id
    `;
    messageId = inserted[0].id;
    created = true;
    await sql`
      UPDATE crm_comm_threads
      SET
        last_message_preview = ${preview},
        last_message_at = NOW(),
        updated_at = NOW(),
        unread_count = CASE WHEN ${carrierNoise} THEN unread_count ELSE unread_count + 1 END
      WHERE id = ${threadId}::uuid
    `;
  }

  const attachmentIds = [];
  if (messageId && attachments.length) {
    const already = await sql`
      SELECT COUNT(*)::int AS count FROM crm_comm_message_attachments WHERE message_id = ${messageId}::uuid
    `;
    if (Number(already[0]?.count || 0) === 0) {
      for (const att of attachments) {
        const rows = await sql`
          INSERT INTO crm_attachments (crm_lead_id, vendor_id, comm_message_id, file_name, mime_type, content_base64, size_bytes, direction)
          VALUES (NULL, ${vendor.id}::uuid, ${messageId}::uuid, ${att.fileName}, ${att.mimeType}, ${att.contentBase64}, ${att.sizeBytes}, 'inbound')
          RETURNING id
        `;
        const attachmentId = rows[0].id;
        attachmentIds.push(attachmentId);
        await sql`
          INSERT INTO crm_comm_message_attachments (message_id, attachment_id)
          VALUES (${messageId}::uuid, ${attachmentId})
          ON CONFLICT DO NOTHING
        `;
      }
    }
  }

  await sql`
    UPDATE crm_vendor_profiles
    SET last_activity_at = NOW(), updated_at = NOW()
    WHERE id = ${vendor.id}::uuid
  `;

  return { threadId, messageId, created, bodyText, attachmentIds };
}

/** Attach [{id,file_name,mime_type,size_bytes,url}] to each thread message (for the Ops thread UI). */
export function groupMessageAttachments(messages, rows) {
  const byMessage = new Map();
  for (const r of rows || []) {
    const key = String(r.message_id);
    if (!byMessage.has(key)) byMessage.set(key, []);
    byMessage.get(key).push({
      id: r.id,
      file_name: r.file_name,
      mime_type: r.mime_type,
      size_bytes: r.size_bytes,
      url: `/api/crm-attachments/${r.id}`,
    });
  }
  return (messages || []).map((m) => ({ ...m, attachments: byMessage.get(String(m.id)) || [] }));
}
