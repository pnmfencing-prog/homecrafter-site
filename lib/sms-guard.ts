import sql from '@/lib/db';

const TWILIO_SID = process.env.TWILIO_SID || process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_TOKEN = process.env.TWILIO_TOKEN || process.env.TWILIO_AUTH_TOKEN || '';
const LOOKUP_CACHE_DAYS = Number(process.env.TWILIO_LOOKUP_CACHE_DAYS || 90);

export function normalizeSmsPhone(phone: string): string {
  const digits = (phone || '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if ((phone || '').startsWith('+')) return phone;
  return digits ? `+${digits}` : '';
}

async function ensureSmsGuardSchema() {
  await sql`
    CREATE TABLE IF NOT EXISTS sms_suppression (
      id SERIAL PRIMARY KEY,
      phone_e164 VARCHAR(20) NOT NULL UNIQUE,
      reason TEXT NOT NULL,
      twilio_error_code INTEGER,
      twilio_error_message TEXT,
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_twilio_sid TEXT,
      source TEXT NOT NULL DEFAULT 'manual',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_sms_suppression_active_phone ON sms_suppression(active, phone_e164)`;
  await sql`
    CREATE TABLE IF NOT EXISTS phone_lookup_cache (
      phone_e164 VARCHAR(20) PRIMARY KEY,
      carrier_name TEXT,
      line_type TEXT,
      mobile_country_code TEXT,
      mobile_network_code TEXT,
      sms_capable BOOLEAN NOT NULL DEFAULT FALSE,
      raw JSONB,
      looked_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

export async function assertSmsCapable(to: string): Promise<string> {
  const cleanTo = normalizeSmsPhone(to);
  if (!/^\+\d{10,15}$/.test(cleanTo)) {
    throw new Error(`Invalid phone: ${to}`);
  }
  if (!TWILIO_SID || !TWILIO_TOKEN) {
    throw new Error('Twilio Lookup environment variables are not configured');
  }

  await ensureSmsGuardSchema();

  const suppressed = await sql`
    SELECT reason
    FROM sms_suppression
    WHERE active = true AND phone_e164 = ${cleanTo}
    LIMIT 1
  `;
  if (suppressed.length) {
    throw new Error(`SMS suppressed for ${cleanTo}: ${suppressed[0].reason}`);
  }

  const cached = await sql`
    SELECT phone_e164, carrier_name, line_type, sms_capable
    FROM phone_lookup_cache
    WHERE phone_e164 = ${cleanTo}
      AND looked_up_at >= NOW() - (${LOOKUP_CACHE_DAYS} || ' days')::interval
    LIMIT 1
  `;
  if (cached.length) {
    if (cached[0].sms_capable === true) return cleanTo;
    throw new Error(`SMS blocked for ${cleanTo}: cached line type ${cached[0].line_type || 'unknown'} is not SMS-capable`);
  }

  const auth = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64');
  const lookupUrl = `https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(cleanTo)}?Fields=line_type_intelligence`;
  const res = await fetch(lookupUrl, { headers: { Authorization: `Basic ${auth}` } });
  const text = await res.text();
  let payload: any = {};
  try { payload = JSON.parse(text); } catch {}
  if (!res.ok) {
    throw new Error(`Twilio Lookup failed for ${cleanTo}: ${text}`);
  }

  const lti = payload.line_type_intelligence || {};
  const lineType = lti.type || payload.line_type || 'unknown';
  const carrierName = lti.carrier_name || lti.carrier || payload.carrier_name || null;
  const smsCapable = lineType === 'mobile';

  await sql`
    INSERT INTO phone_lookup_cache (phone_e164, carrier_name, line_type, mobile_country_code, mobile_network_code, sms_capable, raw)
    VALUES (${cleanTo}, ${carrierName}, ${lineType}, ${lti.mobile_country_code || null}, ${lti.mobile_network_code || null}, ${smsCapable}, ${JSON.stringify(payload)}::jsonb)
    ON CONFLICT (phone_e164) DO UPDATE SET
      carrier_name = EXCLUDED.carrier_name,
      line_type = EXCLUDED.line_type,
      mobile_country_code = EXCLUDED.mobile_country_code,
      mobile_network_code = EXCLUDED.mobile_network_code,
      sms_capable = EXCLUDED.sms_capable,
      raw = EXCLUDED.raw,
      looked_up_at = NOW(),
      updated_at = NOW()
  `;

  if (!smsCapable) {
    const reason = `Twilio Lookup: line type ${lineType || 'unknown'} is not SMS-capable`;
    await sql`
      INSERT INTO sms_suppression (phone_e164, reason, source, active)
      VALUES (${cleanTo}, ${reason}, 'twilio_lookup', true)
      ON CONFLICT (phone_e164) DO UPDATE SET
        reason = EXCLUDED.reason,
        source = EXCLUDED.source,
        active = true,
        last_seen_at = NOW(),
        updated_at = NOW()
    `;
    throw new Error(`SMS blocked for ${cleanTo}: ${reason}`);
  }

  return cleanTo;
}
