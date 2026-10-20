// Inbound Twilio MMS media helpers (2026-10-20, Gina DAmato PNM 12305).
// Root cause: when Twilio media download failed on a photo-only MMS (no Body),
// the webhook skipped the whole message - no CRM activity, no "could not be
// retrieved" warning, no Dan notification. 21 inbound MMS lost 09/20-10/20.
// Fix: retry the download briefly, and always record a message Twilio says
// had media, even when the download fails.

const sleepDefault = (ms) => new Promise((r) => setTimeout(r, ms));
/** @type {(mime: string) => string} */
const defaultExtension = (mime) => { void mime; return 'bin'; };

/** True when an inbound webhook carries something worth recording on the thread. */
export function shouldRecordInbound({ from, body, attachmentCount = 0, expectedMediaCount = 0 }) {
  return Boolean(from) && Boolean((body || '').trim() || attachmentCount > 0 || expectedMediaCount > 0);
}

/** Parse NumMedia the same way everywhere (0..10). */
export function mediaCount(value) {
  return Math.min(Number(value || 0) || 0, 10);
}

/**
 * Download one Twilio media URL with a short retry. Returns {buf, status, attempts}.
 * buf is null on failure. Never throws.
 */
export async function fetchMediaWithRetry(url, {
  fetchImpl = fetch,
  sleep = sleepDefault,
  headers,
  backoffMs = [0, 600, 1500],
  perAttemptTimeoutMs = 4000,
  deadline = Date.now() + 9000,
  now = () => Date.now(),
} = {}) {
  let status = null;
  let attempts = 0;
  for (const wait of backoffMs) {
    if (wait) {
      if (now() + wait >= deadline) break;
      await sleep(wait);
    }
    const remaining = deadline - now();
    if (remaining <= 0) break;
    attempts += 1;
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), Math.min(perAttemptTimeoutMs, remaining)) : null;
    try {
      const res = await fetchImpl(url, { headers, signal: ctl ? ctl.signal : undefined });
      status = res.status;
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length) return { buf, status, attempts };
        status = 'empty';
      }
      // 4xx other than 404/408/429 will not get better by retrying.
      if (typeof status === 'number' && status >= 400 && status < 500 && ![404, 408, 429].includes(status)) break;
    } catch (err) {
      status = err && err.name === 'AbortError' ? 'timeout' : 'error';
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return { buf: null, status, attempts };
}

/**
 * Collect all media for an inbound webhook. getField(name) reads the form.
 * Returns {attachments, failures}. Media are fetched in parallel, order kept.
 */
export async function collectMedia(getField, {
  authHeader = '',
  extensionFromMime = defaultExtension,
  fetchImpl = fetch,
  sleep = sleepDefault,
  budgetMs = 9000,
  now = () => Date.now(),
  log = console.error,
} = {}) {
  const count = mediaCount(getField('NumMedia'));
  if (!count) return { attachments: [], failures: [] };
  const deadline = now() + budgetMs;
  const headers = authHeader ? { Authorization: authHeader } : undefined;
  const stamp = now();
  const results = await Promise.all(Array.from({ length: count }, async (_, i) => {
    const url = String(getField(`MediaUrl${i}`) || '');
    const mimeType = String(getField(`MediaContentType${i}`) || 'application/octet-stream').slice(0, 120);
    if (!url) return { i, fail: { index: i, status: 'no_url', attempts: 0 } };
    const r = await fetchMediaWithRetry(url, { fetchImpl, sleep, headers, deadline, now });
    if (!r.buf) {
      log(`Twilio media fetch failed (${r.status}) after ${r.attempts} attempt(s) for media #${i}`);
      return { i, fail: { index: i, status: r.status, attempts: r.attempts } };
    }
    return {
      i,
      att: {
        fileName: `sms-attachment-${stamp}-${i + 1}.${extensionFromMime(mimeType)}`.slice(0, 180),
        mimeType,
        contentBase64: r.buf.toString('base64'),
        sizeBytes: r.buf.length,
      },
    };
  }));
  return {
    attachments: results.flatMap((r) => (r.att ? [r.att] : [])),
    failures: results.flatMap((r) => (r.fail ? [r.fail] : [])),
  };
}
