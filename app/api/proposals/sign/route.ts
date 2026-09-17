import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { normalizeCrmProfile } from '@/lib/email-policy';
import { assertSmsCapable } from '@/lib/sms-guard';

export const dynamic = 'force-dynamic';

const TWILIO_SID = process.env.TWILIO_SID || process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_TOKEN = process.env.TWILIO_TOKEN || process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_FROM = process.env.TWILIO_FROM || process.env.TWILIO_PHONE_NUMBER || '';
const PNM_TWILIO_FROM = process.env.PNM_TWILIO_FROM || process.env.PNM_TWILIO_NUMBER || '+19083173444';
const DAN_PHONE_E164 = '+19086924847';

function twilioFromForProfile(profileValue: unknown): string {
  const profile = normalizeCrmProfile(profileValue);
  if (profile === 'pnm_fencing') return PNM_TWILIO_FROM;
  if (profile === 'lowes_fencing') return process.env.LOWES_TWILIO_NUMBER || process.env.LOWES_TWILIO_FROM || '+19086766984';
  return TWILIO_FROM || process.env.FENCECRAFTERS_TWILIO_NUMBER || '+19085035473';
}

function formatMoney(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? '');
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

async function sendDanSignSms(body: string, profileValue?: unknown): Promise<void> {
  const fromNumber = twilioFromForProfile(profileValue);
  if (!TWILIO_SID || !TWILIO_TOKEN || !fromNumber) {
    throw new Error('Twilio environment variables are not configured');
  }
  const cleanTo = await assertSmsCapable(DAN_PHONE_E164);
  const params = new URLSearchParams();
  params.append('From', fromNumber);
  params.append('To', cleanTo);
  params.append('Body', body.slice(0, 1400));
  const auth = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64');
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  const text = await res.text();
  let payload: any = {};
  try { payload = JSON.parse(text); } catch {}
  if (!res.ok || payload.error_code || payload.code) {
    throw new Error(`Twilio SMS failed: ${text}`);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { estimate_no, signature_data, signature_name } = body;

    if (!estimate_no || !signature_data || !signature_name) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const beforeRows = await sql`
      SELECT estimate_no, client_name, total, crm_profile, crm_lead_id, status
      FROM proposals
      WHERE estimate_no = ${estimate_no}
      LIMIT 1
    `;
    if (!beforeRows.length) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
    }
    const before = beforeRows[0];
    const alreadySigned = String(before.status || '').toLowerCase() === 'signed';

    // Update proposal with signature data and set status to signed
    const updated = await sql`
      UPDATE proposals
      SET
        signature_data = ${signature_data},
        signature_name = ${signature_name},
        signed_at = NOW(),
        status = 'signed',
        updated_at = NOW()
      WHERE estimate_no = ${estimate_no}
      RETURNING estimate_no, client_name, total, crm_profile, crm_lead_id, status
    `;

    const proposal = updated[0] || before;

    // Real product hook: immediate Dan SMS on first successful sign (not drafts/opens/re-signs)
    if (!alreadySigned) {
      try {
        const leadBit = proposal.crm_lead_id ? ` — lead ${proposal.crm_lead_id}` : '';
        const profile = proposal.crm_profile || 'unknown';
        const text =
          `✅ Proposal signed: #${proposal.estimate_no} — ${proposal.client_name || 'Customer'} — ${formatMoney(proposal.total)} — ${profile}${leadBit}`;
        await sendDanSignSms(text, proposal.crm_profile);
      } catch (notifyErr: any) {
        console.error('[proposals/sign] Dan notify failed:', notifyErr?.message || notifyErr);
      }
    }

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Error saving signature:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
