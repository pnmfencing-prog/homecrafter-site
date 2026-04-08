import { sendBrevoEmail } from './email';

export async function sendFreeLeadBlast(leadId: number) {
  // This is called from the notify endpoint or a cron
  // Logic: if lead has 0 purchases after X hours, blast matching contractors
  // with a "Claim this lead for free" email
  
  // The actual blast is handled by the Python script for now
  // This module provides the email template
}

export function getFreeLeadEmailHtml(leadData: {
  category: string;
  zip: string;
  notes: string;
  leadId: number;
}) {
  const categoryDisplay = leadData.category.charAt(0).toUpperCase() + leadData.category.slice(1);
  
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#faf9f6;font-family:Montserrat,Helvetica,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#faf9f6">
<tr><td align="center" style="padding:20px 0">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">

<tr><td style="background:#1e1845;padding:32px 40px;text-align:center">
  <div style="font-family:Cormorant Garamond,Georgia,serif;font-size:28px;letter-spacing:5px;color:#c4aa6a;font-weight:600">HOMECRAFTER</div>
  <div style="font-size:11px;color:rgba(255,255,255,0.5);letter-spacing:3px;margin-top:6px;text-transform:uppercase">Your Build Specialists</div>
</td></tr>

<tr><td style="background:#ffffff;padding:40px">
  <p style="font-size:22px;color:#1e1845;font-weight:700;margin:0 0 20px;text-align:center">🎁 Complimentary Lead</p>
  
  <p style="font-size:16px;color:#2d2d2d;line-height:1.7;margin:0 0 20px">A new <strong>${categoryDisplay}</strong> project just came in near <strong>${leadData.zip}</strong> — and it's yours to claim, on us.</p>
  
  ${leadData.notes ? `<p style="font-size:15px;color:#555;line-height:1.7;margin:0 0 20px;padding:16px;background:#faf9f6;border-left:3px solid #c4aa6a;border-radius:4px"><em>"${leadData.notes}"</em></p>` : ''}
  
  <p style="font-size:16px;color:#2d2d2d;line-height:1.7;margin:0 0 20px">Sign in and claim this lead — <strong>no charge, no credits needed</strong>. First come, first served.</p>
  
  <table width="100%" cellpadding="0" cellspacing="0">
  <tr><td align="center">
    <a href="https://homecrafter.ai/lead-view.html?id=${leadData.leadId}" style="display:inline-block;background:#1e1845;color:#c4aa6a;font-size:14px;font-weight:600;letter-spacing:2px;text-transform:uppercase;text-decoration:none;padding:16px 40px;border-radius:4px">Claim Free Lead</a>
  </td></tr>
  </table>
  
  <p style="font-size:13px;color:#999;line-height:1.6;margin:20px 0 0;text-align:center">This is a complimentary lead to show you the quality of projects on HomeCrafter.</p>
</td></tr>

<tr><td style="background:#1e1845;padding:24px 40px;text-align:center">
  <div style="font-size:12px;color:rgba(255,255,255,0.4);line-height:1.6">
    <a href="https://homecrafter.ai" style="color:#c4aa6a;text-decoration:none">homecrafter.ai</a><br><br>
    <a href="{{unsubscribe}}" style="color:rgba(255,255,255,0.6)">Unsubscribe</a>
  </div>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}
