import sql from '@/lib/db';

const BREVO_API_KEY = process.env.BREVO_API_KEY || '';
const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

interface LeadEmailData {
  homeownerName: string;
  homeownerEmail: string;
  homeownerPhone: string;
  address: string;
  services: string[];
  notes: string;
  details: Record<string, Record<string, string>>;
  submitted: string;
}

async function sendViaBrevo(to: string, subject: string, html: string) {
  const res = await fetch(BREVO_ENDPOINT, {
    method: 'POST',
    headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sender: { name: 'HomeCrafter', email: 'trent@homecrafter.ai' },
      to: [{ email: to }],
      subject,
      htmlContent: html,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Brevo error ${res.status}: ${err}`);
  }
}

export async function sendLeadNotification(contractorEmail: string, contractorName: string, lead: LeadEmailData) {
  const serviceList = lead.services.map(s => {
    const names: Record<string, string> = {
      Fencing: 'FenceCrafter', Roofing: 'RoofCrafter', Windows: 'WindowCrafter',
      Siding: 'SidingCrafter', Paint: 'PaintCrafter', Locksmith: 'LockCrafter',
      Housekeeper: 'CleanCrafter', WoodFlooring: 'FloorCrafter', Carpet: 'CarpetCrafter',
      HVAC: 'HVACCrafter', Landscaping: 'LandscapeCrafter', Irrigation: 'HydroCrafter',
      Concrete: 'ConcreteCrafter', Kitchen: 'KitchenCrafter', Bathroom: 'BathroomCrafter',
      PestControl: 'PestCrafter', Handyman: 'HandyCrafter', Security: 'SecureCrafter',
      Solar: 'SolarCrafter', PowerWashing: 'WashCrafter',
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
  .header h1 { color: #d4c394; font-size: 22px; letter-spacing: 4px; margin: 0 0 4px; font-weight: 300; }
  .header p { color: rgba(255,255,255,0.5); font-size: 11px; letter-spacing: 3px; text-transform: uppercase; margin: 0; }
  .body { background: #fff; padding: 32px 28px; border: 1px solid #eae7e1; border-top: none; }
  .badge { display: inline-block; background: #1e1845; color: #d4c394; font-size: 11px; font-weight: 600; letter-spacing: 2px; padding: 6px 16px; border-radius: 20px; text-transform: uppercase; margin-bottom: 20px; }
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
    <p style="font-size:18px;color:#1e1845;font-weight:600;margin:0 0 4px;">New ${serviceList} Project</p>
    <p style="font-size:14px;color:#6b6b6b;margin:0 0 20px;">📍 ${lead.address ? lead.address.replace(/.*,?\s*(\w+),?\s*[A-Z]{2}\s*\d{5}.*/, '$1 area') : 'New Jersey'}</p>
    <div class="detail-grid">
      <div class="detail-row">
        <div class="detail-label">Services</div>
        <div class="detail-value">${serviceList}</div>
      </div>
      <div class="detail-row">
        <div class="detail-label">Submitted</div>
        <div class="detail-value">${new Date(lead.submitted).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div>
      </div>
      <div class="detail-row">
        <div class="detail-label">Contact</div>
        <div class="detail-value" style="color:#b8b0a4;font-style:italic;">🔒 Purchase lead to unlock contact details</div>
      </div>
    </div>
    ${lead.notes ? `
    <div class="notes-box">
      <div class="notes-label">Homeowner Notes</div>
      <div class="notes-text">"${lead.notes}"</div>
    </div>` : ''}
    <div class="cta">
      <a href="https://homecrafter.ai/leads-dashboard.html">Unlock This Lead</a>
    </div>
  </div>
  <div class="footer">
    <p>HomeCrafter — Connecting homeowners with trusted local professionals</p>
  </div>
</div>
</body>
</html>`;

  await sendViaBrevo(contractorEmail, `New ${serviceList} Lead Available — HomeCrafter`, html);
}

export async function sendHomeownerConfirmation(email: string, name: string) {
  const firstName = name.split(' ')[0];
  const html = `
<!DOCTYPE html>
<html>
<head>
<style>
  body { font-family: 'Helvetica Neue', Arial, sans-serif; background: #faf9f6; margin: 0; padding: 0; }
  .wrap { max-width: 560px; margin: 0 auto; padding: 24px 16px; }
  .header { background: linear-gradient(135deg, #1e1845, #2a2260); border-radius: 12px 12px 0 0; padding: 32px 24px; text-align: center; }
  .header h1 { color: #d4c394; font-size: 22px; letter-spacing: 4px; margin: 0 0 4px; font-weight: 300; }
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
    <h2>Thanks, ${firstName}!</h2>
    <p>We've received your request and are matching you with trusted local professionals in your area.</p>
    <ul class="steps">
      <li>We're reviewing your project details now</li>
      <li>You'll hear from up to 3 vetted contractors within 72 hours</li>
      <li>Compare quotes and choose the best fit — no obligation</li>
    </ul>
    <p style="font-size:13px;color:#6b6b6b;margin-top:20px;">Questions? Reply to this email anytime.</p>
  </div>
</div>
</body>
</html>`;

  await sendViaBrevo(email, `We're on it, ${firstName}! Your HomeCrafter request`, html);
}

const SERVICE_DISPLAY_NAMES: Record<string, string> = {
  fencing: 'Fencing', roofing: 'Roofing', windows: 'Windows', siding: 'Siding',
  paint: 'Painting', painting: 'Painting', locksmith: 'Locksmith',
  housekeeper: 'Housekeeping', housekeeping: 'Housekeeping',
  woodflooring: 'Wood Flooring', carpet: 'Carpet', hvac: 'HVAC',
  landscaping: 'Landscaping', irrigation: 'Irrigation', concrete: 'Concrete',
  kitchen: 'Kitchen', bathroom: 'Bathroom', pestcontrol: 'Pest Control',
  handyman: 'Handyman', security: 'Security', solar: 'Solar',
  powerwashing: 'Power Washing',
};

export async function sendHomeownerMatchEmail(leadId: number, proAccountId: number, category?: string) {
  try {
    // Look up lead
    const leads = await sql`
      SELECT homeowner_name, homeowner_email, services FROM leads WHERE id = ${leadId}
    `;
    if (leads.length === 0) {
      console.error(`sendHomeownerMatchEmail: lead ${leadId} not found`);
      return;
    }
    const lead = leads[0];

    if (!lead.homeowner_email) {
      console.log(`sendHomeownerMatchEmail: no email for lead ${leadId}, skipping`);
      return;
    }

    // Look up contractor (pro_account)
    const pros = await sql`
      SELECT first_name, last_name, company, email, phone FROM pro_accounts WHERE id = ${proAccountId}
    `;
    if (pros.length === 0) {
      console.error(`sendHomeownerMatchEmail: pro_account ${proAccountId} not found`);
      return;
    }
    const pro = pros[0];

    const proName = [pro.first_name, pro.last_name].filter(Boolean).join(' ');
    const homeownerFirst = (lead.homeowner_name || 'there').split(' ')[0];

    // Determine service display name
    let serviceDisplay = 'Home Improvement';
    if (category) {
      serviceDisplay = SERVICE_DISPLAY_NAMES[category.toLowerCase()] || category;
    } else if (lead.services) {
      const svcArr = Array.isArray(lead.services) ? lead.services : [lead.services];
      serviceDisplay = svcArr.map((s: string) => SERVICE_DISPLAY_NAMES[s.toLowerCase()] || s).join(' & ');
    }

    const subject = `Great news! A ${serviceDisplay} pro is ready to help`;

    const html = `
<!DOCTYPE html>
<html>
<head>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600;700&family=Montserrat:wght@400;500;600;700&display=swap');
  body { font-family: 'Montserrat', 'Helvetica Neue', Arial, sans-serif; background: #faf9f6; margin: 0; padding: 0; color: #2d2d2d; }
  .wrap { max-width: 560px; margin: 0 auto; padding: 24px 16px; }
  .header { background: linear-gradient(135deg, #1e1845, #2a2260); border-radius: 12px 12px 0 0; padding: 36px 24px; text-align: center; }
  .header h1 { font-family: 'Cormorant Garamond', Georgia, serif; color: #d4c394; font-size: 22px; letter-spacing: 4px; margin: 0 0 4px; font-weight: 300; }
  .header p { color: rgba(255,255,255,0.5); font-size: 11px; letter-spacing: 3px; text-transform: uppercase; margin: 0; font-family: 'Montserrat', sans-serif; }
  .body-section { background: #fff; padding: 36px 28px; border: 1px solid #eae7e1; border-top: none; }
  .greeting { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 22px; color: #1e1845; font-weight: 600; margin: 0 0 8px; }
  .intro { font-size: 14px; color: #555; line-height: 1.7; margin: 0 0 24px; }
  .pro-card { background: linear-gradient(135deg, #faf9f6, #f5f2eb); border: 1px solid #e8e3d9; border-left: 4px solid #c4aa6a; border-radius: 0 10px 10px 0; padding: 24px; margin: 0 0 24px; }
  .pro-card-label { font-size: 10px; font-weight: 700; letter-spacing: 2.5px; text-transform: uppercase; color: #c4aa6a; margin: 0 0 12px; }
  .pro-name { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 20px; color: #1e1845; font-weight: 700; margin: 0 0 4px; }
  .pro-company { font-size: 13px; color: #6b6b6b; margin: 0 0 16px; font-style: italic; }
  .pro-detail { padding: 6px 0; font-size: 13px; color: #2d2d2d; }
  .pro-detail .icon { display: inline-block; width: 20px; text-align: center; margin-right: 8px; }
  .pro-detail a { color: #1e1845; text-decoration: none; font-weight: 500; }
  .service-badge { display: inline-block; background: #1e1845; color: #d4c394; font-size: 11px; font-weight: 600; letter-spacing: 2px; padding: 6px 16px; border-radius: 20px; text-transform: uppercase; margin-top: 12px; }
  .note-box { background: #faf9f6; border-radius: 8px; padding: 18px 20px; margin: 0 0 24px; text-align: center; }
  .note-box p { font-size: 14px; color: #555; line-height: 1.7; margin: 0; }
  .note-box strong { color: #1e1845; }
  .cta { text-align: center; padding: 8px 0 0; }
  .cta a { display: inline-block; background: linear-gradient(135deg, #1e1845, #2a2260); color: #d4c394; font-size: 12px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; padding: 14px 32px; border-radius: 6px; text-decoration: none; }
  .footer { background: #f8f6f2; border-radius: 0 0 12px 12px; padding: 20px 24px; text-align: center; border: 1px solid #eae7e1; border-top: none; }
  .footer p { font-size: 11px; color: #b8b0a4; margin: 0; font-family: 'Montserrat', sans-serif; }
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <h1>HOMECRAFTER</h1>
    <p>Your Pro Match</p>
  </div>
  <div class="body-section">
    <p class="greeting">Hi ${homeownerFirst}! 🎉</p>
    <p class="intro">Great news — a qualified <strong>${serviceDisplay}</strong> professional has picked up your project request and is ready to help.</p>

    <div class="pro-card">
      <div class="pro-card-label">✦ Your Matched Pro</div>
      <div class="pro-name">${proName}</div>
      ${pro.company ? `<div class="pro-company">${pro.company}</div>` : ''}
      ${pro.phone ? `<div class="pro-detail"><span class="icon">📞</span><a href="tel:${pro.phone}">${pro.phone}</a></div>` : ''}
      ${pro.email ? `<div class="pro-detail"><span class="icon">✉️</span><a href="mailto:${pro.email}">${pro.email}</a></div>` : ''}
      <div class="service-badge">${serviceDisplay}</div>
    </div>

    <div class="note-box">
      <p>They'll be reaching out to you shortly to discuss your project.<br>
      Feel free to <strong>contact them directly</strong> — they already have your project details!</p>
    </div>
  </div>
  <div class="footer">
    <p>HomeCrafter — Connecting homeowners with trusted local professionals</p>
    <p style="margin-top:8px;font-size:10px;color:#ccc;">You received this because you submitted a project request on HomeCrafter.</p>
  </div>
</div>
</body>
</html>`;

    await sendViaBrevo(lead.homeowner_email, subject, html);
    console.log(`Homeowner match email sent: lead=${leadId}, pro=${proAccountId}, to=${lead.homeowner_email}`);
  } catch (err) {
    console.error('sendHomeownerMatchEmail error:', err);
    // Don't throw — this is a non-critical notification
  }
}
