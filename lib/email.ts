import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: 'smtp.zoho.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.ZOHO_EMAIL || 'trent@homecrafter.ai',
    pass: process.env.ZOHO_PASSWORD || '',
  },
});

interface LeadEmailData {
  homeownerName: string;
  homeownerEmail: string;
  homeownerPhone: string;
  address: string;
  services: string[];
  notes: string;
  submitted: string;
}

export async function sendLeadNotification(contractorEmail: string, contractorName: string, lead: LeadEmailData) {
  const serviceList = lead.services.map(s => {
    const names: Record<string, string> = {
      fencing: 'FenceCrafter', roofing: 'RoofCrafter', windows: 'WindowCrafter',
      siding: 'SidingCrafter', painting: 'PaintCrafter'
    };
    return names[s] || s;
  }).join(', ');

  const html = `
<!DOCTYPE html>
<html>
<head>
<style>
  body { font-family: 'Helvetica Neue', Arial, sans-serif; background: #faf9f6; margin: 0; padding: 0; }
  .wrap { max-width: 560px; margin: 0 auto; padding: 24px 16px; }
  .header { background: linear-gradient(135deg, #1e1845, #2a2260); border-radius: 12px 12px 0 0; padding: 32px 24px; text-align: center; }
  .header h1 { color: #d4c394; font-size: 28px; letter-spacing: 6px; margin: 0 0 4px; font-weight: 300; }
  .header p { color: rgba(255,255,255,0.5); font-size: 11px; letter-spacing: 3px; text-transform: uppercase; margin: 0; }
  .body { background: #fff; padding: 32px 28px; border: 1px solid #eae7e1; border-top: none; }
  .badge { display: inline-block; background: #1e1845; color: #d4c394; font-size: 11px; font-weight: 600; letter-spacing: 2px; padding: 6px 16px; border-radius: 20px; text-transform: uppercase; margin-bottom: 20px; }
  .lead-name { font-size: 22px; color: #1e1845; font-weight: 600; margin: 0 0 4px; }
  .lead-address { font-size: 14px; color: #6b6b6b; margin: 0 0 20px; }
  .detail-grid { border-top: 1px solid #f0ede6; padding-top: 16px; }
  .detail-row { display: flex; padding: 8px 0; border-bottom: 1px solid #f8f6f2; }
  .detail-label { width: 100px; font-size: 10px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: #c4aa6a; padding-top: 2px; }
  .detail-value { flex: 1; font-size: 14px; color: #2d2d2d; }
  .notes-box { background: #faf9f6; border-left: 3px solid #c4aa6a; padding: 14px 18px; margin-top: 16px; border-radius: 0 6px 6px 0; }
  .notes-label { font-size: 10px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: #c4aa6a; margin-bottom: 6px; }
  .notes-text { font-size: 13px; color: #2d2d2d; font-style: italic; line-height: 1.6; }
  .cta { text-align: center; padding: 24px 0 8px; }
  .cta a { display: inline-block; background: #1e1845; color: #d4c394; font-size: 12px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; padding: 14px 32px; border-radius: 6px; text-decoration: none; }
  .footer { background: #f8f6f2; border-radius: 0 0 12px 12px; padding: 20px 24px; text-align: center; border: 1px solid #eae7e1; border-top: none; }
  .footer p { font-size: 11px; color: #b8b0a4; margin: 0; }
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <h1>HOMECRAFTER</h1>
    <p>New Lead Available</p>
  </div>
  <div class="body">
    <div class="badge">🔔 New Lead</div>
    <p class="lead-name">${lead.homeownerName}</p>
    <p class="lead-address">📍 ${lead.address}</p>
    <div class="detail-grid">
      <div class="detail-row">
        <div class="detail-label">Services</div>
        <div class="detail-value">${serviceList}</div>
      </div>
      <div class="detail-row">
        <div class="detail-label">Email</div>
        <div class="detail-value"><a href="mailto:${lead.homeownerEmail}" style="color:#1e1845">${lead.homeownerEmail}</a></div>
      </div>
      <div class="detail-row">
        <div class="detail-label">Phone</div>
        <div class="detail-value"><a href="tel:${lead.homeownerPhone}" style="color:#1e1845">${lead.homeownerPhone}</a></div>
      </div>
      <div class="detail-row">
        <div class="detail-label">Submitted</div>
        <div class="detail-value">${new Date(lead.submitted).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div>
      </div>
    </div>
    ${lead.notes ? `
    <div class="notes-box">
      <div class="notes-label">Homeowner Notes</div>
      <div class="notes-text">"${lead.notes}"</div>
    </div>` : ''}
    <div class="cta">
      <a href="https://homecrafter.ai/pro-login.html">View in Dashboard</a>
    </div>
  </div>
  <div class="footer">
    <p>HomeCrafter — Connecting homeowners with trusted local professionals</p>
  </div>
</div>
</body>
</html>`;

  await transporter.sendMail({
    from: '"HomeCrafter" <trent@homecrafter.ai>',
    to: contractorEmail,
    subject: `New ${serviceList} Lead — ${lead.address}`,
    html,
  });
}

export async function sendHomeownerConfirmation(email: string, name: string) {
  const html = `
<!DOCTYPE html>
<html>
<head>
<style>
  body { font-family: 'Helvetica Neue', Arial, sans-serif; background: #faf9f6; margin: 0; padding: 0; }
  .wrap { max-width: 560px; margin: 0 auto; padding: 24px 16px; }
  .header { background: linear-gradient(135deg, #1e1845, #2a2260); border-radius: 12px 12px 0 0; padding: 32px 24px; text-align: center; }
  .header h1 { color: #d4c394; font-size: 28px; letter-spacing: 6px; margin: 0 0 4px; font-weight: 300; }
  .body { background: #fff; padding: 32px 28px; border: 1px solid #eae7e1; border-top: none; border-radius: 0 0 12px 12px; }
  .body h2 { color: #1e1845; font-size: 20px; margin: 0 0 12px; }
  .body p { font-size: 14px; color: #2d2d2d; line-height: 1.7; }
  .steps { margin: 20px 0; padding: 0; list-style: none; }
  .steps li { padding: 8px 0 8px 28px; position: relative; font-size: 13px; color: #2d2d2d; }
  .steps li::before { content: '✦'; position: absolute; left: 0; color: #c4aa6a; }
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <h1>HOMECRAFTER</h1>
  </div>
  <div class="body">
    <h2>Thanks, ${name.split(' ')[0]}!</h2>
    <p>We've received your request and are matching you with trusted local professionals in your area.</p>
    <ul class="steps">
      <li>We're reviewing your project details now</li>
      <li>You'll hear from up to 3 vetted contractors within 24 hours</li>
      <li>Compare quotes and choose the best fit — no obligation</li>
    </ul>
    <p style="font-size:13px;color:#6b6b6b;margin-top:20px;">Questions? Reply to this email anytime.</p>
  </div>
</div>
</body>
</html>`;

  await transporter.sendMail({
    from: '"HomeCrafter" <trent@homecrafter.ai>',
    to: email,
    subject: `We're on it, ${name.split(' ')[0]}! Your HomeCrafter request`,
    html,
  });
}
