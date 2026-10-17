/**
 * Brevo's /v3/smtp/email rejects an empty `attachment` array with
 * 400 "missing_parameter: attachment is missing". Only include the key when
 * there is at least one attachment with real base64 content.
 * @param {Array<{ name?: string, content?: string }> | null | undefined} list
 * @returns {{ attachment?: Array<{ name: string, content: string }> }}
 */
export function brevoAttachmentField(list) {
  const clean = (Array.isArray(list) ? list : [])
    .filter((a) => a && typeof a.content === 'string' && a.content.length > 0)
    .map((a) => ({ name: String(a.name || 'attachment').slice(0, 180), content: a.content }));
  return clean.length ? { attachment: clean } : {};
}
