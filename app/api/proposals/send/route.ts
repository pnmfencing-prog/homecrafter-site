import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { PNM_FENCING_EMAIL_SENDING_PAUSED, pnmFencingEmailPausedResponse } from '@/lib/email-policy';

function isAdmin(request: NextRequest): boolean {
  const auth = request.headers.get('authorization') || '';
  const token = auth.replace('Bearer ', '');
  const adminToken = process.env.ADMIN_TOKEN || 'hc-admin-2026';
  return token === adminToken;
}

export async function POST(request: NextRequest) {
  if (!isAdmin(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { id } = body;

  const proposals = await sql`SELECT * FROM proposals WHERE id = ${id}`;
  if (!proposals.length) return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });

  const p = proposals[0];
  if (!p.client_email) return NextResponse.json({ error: 'No client email on this proposal' }, { status: 400 });
  if (PNM_FENCING_EMAIL_SENDING_PAUSED) {
    return NextResponse.json(pnmFencingEmailPausedResponse(), { status: 423 });
  }

  const spot = Number(p.spot_holding_fee ?? 150);
  const gateText = p.gate_count > 0 ? `${p.gate_count} gate${p.gate_count > 1 ? 's' : ''}` : 'no gates';
  const scopeText = p.description_override
    ? String(p.description_override).replace(/\s+/g, ' ').trim()
    : `${p.footage || ''} LF of ${p.height || ''} ${(p.color || 'white').toUpperCase()} ${p.material || 'vinyl'} privacy fence, ${gateText}`.replace(/\s+/g, ' ').trim();
  const companyName = body.company_name || 'PNM Fencing NJ LLC';

  const emailHtml = `
<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f5f5f0;font-family:Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f0;padding:30px 15px;">
<tr><td align="center">
<table width="650" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

<!-- Header -->
<tr><td style="background:#1e1845;padding:30px 40px;text-align:center;">
  <div style="font-size:26px;font-weight:bold;color:#c4aa6a;letter-spacing:3px;">PNM FENCING NJ LLC</div>
  <div style="font-size:11px;color:rgba(255,255,255,0.5);margin-top:6px;letter-spacing:1px;">PROPOSAL</div>
</td></tr>

<!-- Body -->
<tr><td style="padding:35px 40px;">
  <div style="font-size:14px;color:#333;line-height:1.7;">
    <p>Dear ${p.client_name || 'Valued Customer'},</p>
    <p>Thank you for your interest in ${companyName}. Please find your proposal details below.</p>
  </div>

  <!-- Estimate Info -->
  <table width="100%" style="margin:20px 0;border-collapse:collapse;">
    <tr>
      <td style="padding:8px 12px;background:#faf9f6;font-size:12px;font-weight:bold;color:#666;border-bottom:1px solid #eee;">Estimate No.</td>
      <td style="padding:8px 12px;background:#faf9f6;font-size:14px;border-bottom:1px solid #eee;">${p.estimate_no}</td>
    </tr>
    <tr>
      <td style="padding:8px 12px;font-size:12px;font-weight:bold;color:#666;border-bottom:1px solid #eee;">Address</td>
      <td style="padding:8px 12px;font-size:14px;border-bottom:1px solid #eee;">${[p.client_address, p.client_city, p.client_state, p.client_zip].filter(Boolean).join(', ')}</td>
    </tr>
    <tr>
      <td style="padding:8px 12px;background:#faf9f6;font-size:12px;font-weight:bold;color:#666;border-bottom:1px solid #eee;">Scope</td>
      <td style="padding:8px 12px;background:#faf9f6;font-size:14px;border-bottom:1px solid #eee;">${scopeText}</td>
    </tr>
  </table>

  <!-- Total -->
  <div style="background:#1e1845;border-radius:8px;padding:20px 25px;margin:20px 0;text-align:center;">
    <div style="font-size:11px;color:rgba(255,255,255,0.6);letter-spacing:1px;text-transform:uppercase;">Project Total</div>
    <div style="font-size:32px;font-weight:bold;color:#c4aa6a;margin-top:4px;">$${Number(p.total).toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
  </div>

  <!-- Payment Breakdown -->
  <div style="font-size:13px;font-weight:bold;color:#1e1845;margin-bottom:10px;">Payment Schedule</div>
  <table width="100%" style="border-collapse:collapse;font-size:13px;">
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;">Spot Holding Fee <span style="color:#999;font-size:11px;">(applied to total)</span></td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;font-weight:600;">$${Number(spot).toFixed(2)}</td>
    </tr>
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;background:#faf9f6;">Deposit <span style="color:#999;font-size:11px;">(50%)</span></td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;background:#faf9f6;text-align:right;font-weight:600;">$${Number(p.deposit || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
    </tr>
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;">Material Delivery <span style="color:#999;font-size:11px;">(25%)</span></td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;font-weight:600;">$${Number(p.installment_2 || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
    </tr>
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;background:#faf9f6;">Completion <span style="color:#999;font-size:11px;">(25%)</span></td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;background:#faf9f6;text-align:right;font-weight:600;">$${Number(p.installment_3 || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
    </tr>
  </table>

  <div style="background:#f8f9fa;border:1px solid #e9ecef;border-radius:8px;padding:20px;margin:25px 0;text-align:center;">
    <p style="font-size:14px;color:#333;margin-bottom:15px;font-weight:600;">
      📄 View & Sign Your Proposal
    </p>
    <a href="https://homecrafter.ai/api/proposals/pdf?estimate_no=${p.estimate_no}&token=hc-admin-2026" 
       style="display:inline-block;background:#1e1845;color:#c4aa6a;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">
      VIEW PROPOSAL & SIGN ONLINE
    </a>
    <p style="font-size:11px;color:#666;margin-top:10px;">
      Mobile-friendly • Digital signature • Instant confirmation
    </p>
  </div>

  <p style="font-size:13px;color:#333;">
    To lock in your pricing and reserve your spot on the calendar, simply sign online above or call us at <strong>1-(908)-692-4847</strong>.
  </p>
</td></tr>

<!-- Footer -->
<tr><td style="background:#faf9f6;padding:20px 40px;text-align:center;border-top:1px solid #eee;">
  <div style="font-size:11px;color:#999;">
    ${companyName} · PO Box ___ Oakhurst, NJ 07712<br>
    1-(908)-692-4847 · pnmfencing@gmail.com
  </div>
</td></tr>

</table>
</td></tr></table>
</body></html>`;

  // Send via Brevo
  const brevoKey = process.env.BREVO_API_KEY;
  if (!brevoKey) return NextResponse.json({ error: 'Brevo API key not configured' }, { status: 500 });

  const brevoRes = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': brevoKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender: { name: companyName, email: 'trent@homecrafter.ai' },
      replyTo: { name: 'PNM Fencing', email: 'pnmfencing@gmail.com' },
      to: [{ email: p.client_email, name: p.client_name || undefined }],
      subject: `Proposal #${p.estimate_no} from ${companyName}`,
      htmlContent: emailHtml,
    }),
  });

  if (!brevoRes.ok) {
    const err = await brevoRes.text();
    return NextResponse.json({ error: 'Failed to send email', details: err }, { status: 500 });
  }

  // Update status to 'sent'
  await sql`UPDATE proposals SET status = 'sent', updated_at = NOW() WHERE id = ${id}`;

  return NextResponse.json({ success: true, message: `Proposal sent to ${p.client_email}` });
}
