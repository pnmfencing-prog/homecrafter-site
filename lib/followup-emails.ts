const LEAD_VIEW_URL = 'https://homecrafter.ai/lead-view.html';

const SERVICE_NAMES: Record<string, string> = {
  Fencing: 'Fencing', Roofing: 'Roofing', Windows: 'Windows',
  Siding: 'Siding', Paint: 'Painting',
  Locksmith: 'Locksmith', Housekeeper: 'Housekeeping',
  WoodFlooring: 'Wood Flooring', Carpet: 'Carpet', HVAC: 'HVAC',
  Landscaping: 'Landscaping', Irrigation: 'Irrigation',
  Concrete: 'Concrete', Kitchen: 'Kitchen', Bathroom: 'Bathroom',
  PestControl: 'Pest Control', Handyman: 'Handyman', Security: 'Security',
  Solar: 'Solar', PowerWashing: 'Power Washing',
};

function getServiceLabels(services: string[]): string {
  return services.map(s => SERVICE_NAMES[s] || s).join(' & ');
}

function getHoursRemaining(submittedAt: Date): number {
  const now = new Date();
  const expiryMs = submittedAt.getTime() + 72 * 60 * 60 * 1000;
  return Math.max(0, Math.round((expiryMs - now.getTime()) / (60 * 60 * 1000)));
}

export function build12hReminderHtml(
  contractorName: string,
  services: string[],
  zip: string,
  leadId: number,
  submittedAt: Date
): string {
  const serviceLabels = getServiceLabels(services);
  const viewUrl = `${LEAD_VIEW_URL}?lead=${leadId}`;
  const hoursLeft = getHoursRemaining(submittedAt);
  const firstName = contractorName.split(' ')[0];

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600;700&family=Montserrat:wght@400;500;600;700&display=swap');
  body { margin: 0; padding: 0; background-color: #faf9f6; font-family: 'Montserrat', 'Helvetica Neue', Arial, sans-serif; }
  .wrapper { max-width: 580px; margin: 0 auto; padding: 32px 16px; }
  .header { background: linear-gradient(135deg, #1e1845 0%, #2a2260 100%); border-radius: 16px 16px 0 0; padding: 40px 32px; text-align: center; }
  .header h1 { font-family: 'Cormorant Garamond', Georgia, serif; color: #c4aa6a; font-size: 22px; letter-spacing: 4px; margin: 0 0 6px; font-weight: 600; text-transform: uppercase; }
  .header .subtitle { color: rgba(255,255,255,0.5); font-family: 'Montserrat', sans-serif; font-size: 11px; letter-spacing: 3px; text-transform: uppercase; margin: 0; }
  .content { background: #ffffff; padding: 36px 32px; border-left: 1px solid #eae7e1; border-right: 1px solid #eae7e1; }
  .greeting { font-family: 'Montserrat', sans-serif; font-size: 14px; color: #555; margin: 0 0 24px; line-height: 1.6; }
  .lead-card { background: #faf9f6; border: 1px solid #eae7e1; border-radius: 12px; padding: 28px 24px; margin-bottom: 28px; }
  .lead-badge { display: inline-block; background: #2d6b3f; color: #ffffff; font-family: 'Montserrat', sans-serif; font-size: 10px; font-weight: 700; letter-spacing: 2px; padding: 5px 14px; border-radius: 20px; text-transform: uppercase; margin-bottom: 16px; }
  .lead-title { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 24px; color: #1e1845; font-weight: 700; margin: 0 0 8px; line-height: 1.3; }
  .lead-location { font-family: 'Montserrat', sans-serif; font-size: 13px; color: #888; margin: 0 0 16px; }
  .lead-detail { display: block; padding: 10px 0; border-bottom: 1px solid #f0ede6; }
  .lead-detail:last-child { border-bottom: none; }
  .detail-label { font-family: 'Montserrat', sans-serif; font-size: 10px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: #c4aa6a; }
  .detail-value { font-family: 'Montserrat', sans-serif; font-size: 14px; color: #2d2d2d; margin-top: 2px; }
  .time-badge { display: inline-block; background: #fff3e0; color: #e65100; font-family: 'Montserrat', sans-serif; font-size: 12px; font-weight: 600; padding: 8px 16px; border-radius: 8px; margin-bottom: 16px; }
  .cta-wrap { text-align: center; margin: 8px 0; }
  .cta-btn { display: inline-block; background: linear-gradient(135deg, #c4aa6a, #b8994f); color: #1e1845; font-family: 'Montserrat', sans-serif; font-size: 13px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; padding: 16px 40px; border-radius: 8px; text-decoration: none; }
  .urgency { font-family: 'Montserrat', sans-serif; font-size: 12px; color: #888; text-align: center; margin-top: 12px; }
  .footer { background: #f5f3ee; border-radius: 0 0 16px 16px; padding: 24px 32px; text-align: center; border: 1px solid #eae7e1; border-top: none; }
  .footer p { font-family: 'Montserrat', sans-serif; font-size: 11px; color: #b8b0a4; margin: 0 0 4px; }
  .footer .brand { font-family: 'Cormorant Garamond', Georgia, serif; color: #1e1845; font-size: 14px; letter-spacing: 3px; font-weight: 600; }
</style>
</head>
<body>
<div class="wrapper">
  <div class="header">
    <h1>HomeCrafter</h1>
    <p class="subtitle">Lead Still Available</p>
  </div>
  <div class="content">
    <p class="greeting">Hi ${firstName},<br>Contractors in your area are viewing this ${serviceLabels.toLowerCase()} lead right now. Claim it before someone else does.</p>
    <div class="lead-card">
      <span class="lead-badge">🔥 Pros Are Viewing This Lead</span>
      <h2 class="lead-title">${serviceLabels} Lead — ${zip ? `Zip ${zip}` : 'New Jersey'}</h2>
      <p class="lead-location">📍 ${zip ? `Zip code ${zip}` : 'New Jersey'}</p>
      <div class="time-badge">⏰ ~${hoursLeft} hours remaining before expiry</div>
      <div class="lead-detail">
        <span class="detail-label">Services Needed</span>
        <div class="detail-value">${serviceLabels}</div>
      </div>
      <div class="lead-detail">
        <span class="detail-label">Status</span>
        <div class="detail-value" style="color:#2d6b3f;font-weight:600;">Other contractors are viewing — claim yours now</div>
      </div>
    </div>
    <div class="cta-wrap">
      <a href="${viewUrl}" class="cta-btn">Claim This Lead</a>
    </div>
    <p class="urgency">Only 3 contractors can purchase this lead. Don't miss your window.</p>
  </div>
  <div class="footer">
    <p class="brand">HOMECRAFTER</p>
    <p>Connecting homeowners with trusted local professionals</p>
  </div>
</div>
</body>
</html>`;
}

export function build48hReminderHtml(
  contractorName: string,
  services: string[],
  zip: string,
  leadId: number,
  submittedAt: Date
): string {
  const serviceLabels = getServiceLabels(services);
  const viewUrl = `${LEAD_VIEW_URL}?lead=${leadId}`;
  const hoursLeft = getHoursRemaining(submittedAt);
  const firstName = contractorName.split(' ')[0];

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600;700&family=Montserrat:wght@400;500;600;700&display=swap');
  body { margin: 0; padding: 0; background-color: #faf9f6; font-family: 'Montserrat', 'Helvetica Neue', Arial, sans-serif; }
  .wrapper { max-width: 580px; margin: 0 auto; padding: 32px 16px; }
  .header { background: linear-gradient(135deg, #8b1a1a 0%, #a62626 100%); border-radius: 16px 16px 0 0; padding: 40px 32px; text-align: center; }
  .header h1 { font-family: 'Cormorant Garamond', Georgia, serif; color: #ffd700; font-size: 22px; letter-spacing: 4px; margin: 0 0 6px; font-weight: 600; text-transform: uppercase; }
  .header .subtitle { color: rgba(255,255,255,0.7); font-family: 'Montserrat', sans-serif; font-size: 11px; letter-spacing: 3px; text-transform: uppercase; margin: 0; }
  .content { background: #ffffff; padding: 36px 32px; border-left: 1px solid #eae7e1; border-right: 1px solid #eae7e1; }
  .greeting { font-family: 'Montserrat', sans-serif; font-size: 14px; color: #555; margin: 0 0 24px; line-height: 1.6; }
  .lead-card { background: #fff8f8; border: 1px solid #f0d0d0; border-radius: 12px; padding: 28px 24px; margin-bottom: 28px; }
  .lead-badge { display: inline-block; background: #c62828; color: #ffffff; font-family: 'Montserrat', sans-serif; font-size: 10px; font-weight: 700; letter-spacing: 2px; padding: 5px 14px; border-radius: 20px; text-transform: uppercase; margin-bottom: 16px; }
  .lead-title { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 24px; color: #1e1845; font-weight: 700; margin: 0 0 8px; line-height: 1.3; }
  .lead-location { font-family: 'Montserrat', sans-serif; font-size: 13px; color: #888; margin: 0 0 16px; }
  .lead-detail { display: block; padding: 10px 0; border-bottom: 1px solid #f0ede6; }
  .lead-detail:last-child { border-bottom: none; }
  .detail-label { font-family: 'Montserrat', sans-serif; font-size: 10px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: #c4aa6a; }
  .detail-value { font-family: 'Montserrat', sans-serif; font-size: 14px; color: #2d2d2d; margin-top: 2px; }
  .countdown { display: inline-block; background: #c62828; color: #ffffff; font-family: 'Montserrat', sans-serif; font-size: 14px; font-weight: 700; padding: 10px 20px; border-radius: 8px; margin-bottom: 16px; }
  .cta-wrap { text-align: center; margin: 8px 0; }
  .cta-btn { display: inline-block; background: linear-gradient(135deg, #c62828, #e53935); color: #ffffff; font-family: 'Montserrat', sans-serif; font-size: 14px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; padding: 18px 44px; border-radius: 8px; text-decoration: none; }
  .urgency { font-family: 'Montserrat', sans-serif; font-size: 13px; color: #c62828; text-align: center; margin-top: 12px; font-weight: 600; }
  .footer { background: #f5f3ee; border-radius: 0 0 16px 16px; padding: 24px 32px; text-align: center; border: 1px solid #eae7e1; border-top: none; }
  .footer p { font-family: 'Montserrat', sans-serif; font-size: 11px; color: #b8b0a4; margin: 0 0 4px; }
  .footer .brand { font-family: 'Cormorant Garamond', Georgia, serif; color: #1e1845; font-size: 14px; letter-spacing: 3px; font-weight: 600; }
</style>
</head>
<body>
<div class="wrapper">
  <div class="header">
    <h1>HomeCrafter</h1>
    <p class="subtitle">⚠️ Last Chance</p>
  </div>
  <div class="content">
    <p class="greeting">Hi ${firstName},<br>Last spot remaining on this ${serviceLabels.toLowerCase()} lead. It expires in <strong>${hoursLeft} hours</strong> — once it's gone, it's gone.</p>
    <div class="lead-card">
      <span class="lead-badge">🔥 Expiring Soon</span>
      <h2 class="lead-title">${serviceLabels} Lead — ${zip ? `Zip ${zip}` : 'New Jersey'}</h2>
      <p class="lead-location">📍 ${zip ? `Zip code ${zip}` : 'New Jersey'}</p>
      <div class="countdown">⏳ Only ~${hoursLeft} hours left</div>
      <div class="lead-detail">
        <span class="detail-label">Services Needed</span>
        <div class="detail-value">${serviceLabels}</div>
      </div>
      <div class="lead-detail">
        <span class="detail-label">Urgency</span>
        <div class="detail-value" style="color:#c62828;font-weight:600;">Expires in ${hoursLeft} hours — act now or lose it</div>
      </div>
    </div>
    <div class="cta-wrap">
      <a href="${viewUrl}" class="cta-btn">Claim Before It's Gone</a>
    </div>
    <p class="urgency">After expiry, this homeowner's info is gone permanently.</p>
  </div>
  <div class="footer">
    <p class="brand">HOMECRAFTER</p>
    <p>Connecting homeowners with trusted local professionals</p>
  </div>
</div>
</body>
</html>`;
}

export function get12hSubject(services: string[]): string {
  const serviceLabels = getServiceLabels(services);
  return `Contractors Are Viewing This ${serviceLabels} Lead — Claim It Now`;
}

export function get48hSubject(services: string[]): string {
  const serviceLabels = getServiceLabels(services);
  return `This ${serviceLabels} Lead Expires in 24 Hours`;
}
