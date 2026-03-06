import sql from '@/lib/db';
import { getZipCoords } from '@/lib/geo';

const BREVO_API_KEY = process.env.BREVO_API_KEY || '';
const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';
const RADIUS_MILES = 40;
// No contractor cap — email all matches
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

const SERVICE_TO_CATEGORY: Record<string, string[]> = {
  Fencing: ['Fencing'], Roofing: ['Roofing'], Windows: ['Windows'],
  Siding: ['Siding'], Paint: ['Paint'],
  Locksmith: ['Locksmith'], Housekeeper: ['Housekeeper'],
  WoodFlooring: ['WoodFlooring'], Carpet: ['Carpet'], HVAC: ['HVAC'],
  Landscaping: ['Landscaping', 'Irrigation'], Irrigation: ['Landscaping', 'Irrigation'],
  Concrete: ['Concrete'], Kitchen: ['Kitchen', 'Bathroom'], Bathroom: ['Kitchen', 'Bathroom'],
  PestControl: ['PestControl'], Handyman: ['Handyman'], Security: ['Security'],
  Solar: ['Solar'], PowerWashing: ['PowerWashing'],
};

function buildEmailHtml(contractorName: string, services: string[], zip: string, leadId: number): string {
  const serviceLabels = services.map(s => SERVICE_NAMES[s.toLowerCase()] || s).join(' & ');
  const viewUrl = `${LEAD_VIEW_URL}?lead=${leadId}`;

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
  .lead-badge { display: inline-block; background: #1e1845; color: #c4aa6a; font-family: 'Montserrat', sans-serif; font-size: 10px; font-weight: 700; letter-spacing: 2px; padding: 5px 14px; border-radius: 20px; text-transform: uppercase; margin-bottom: 16px; }
  .lead-title { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 24px; color: #1e1845; font-weight: 700; margin: 0 0 8px; line-height: 1.3; }
  .lead-location { font-family: 'Montserrat', sans-serif; font-size: 13px; color: #888; margin: 0 0 16px; }
  .lead-detail { display: block; padding: 10px 0; border-bottom: 1px solid #f0ede6; }
  .lead-detail:last-child { border-bottom: none; }
  .detail-label { font-family: 'Montserrat', sans-serif; font-size: 10px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: #c4aa6a; }
  .detail-value { font-family: 'Montserrat', sans-serif; font-size: 14px; color: #2d2d2d; margin-top: 2px; }
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
    <p class="subtitle">New Lead Available</p>
  </div>
  <div class="content">
    <p class="greeting">Hi ${contractorName.split(' ')[0]},<br>A new project request just came in that matches your service area.</p>
    <div class="lead-card">
      <span class="lead-badge">🔔 New Lead</span>
      <h2 class="lead-title">New ${serviceLabels} Lead in Your Area</h2>
      <p class="lead-location">📍 ${zip ? `Zip code ${zip}` : 'New Jersey'}</p>
      <div class="lead-detail">
        <span class="detail-label">Services Needed</span>
        <div class="detail-value">${serviceLabels}</div>
      </div>
      <div class="lead-detail">
        <span class="detail-label">Contact Info</span>
        <div class="detail-value" style="color:#b8b0a4;font-style:italic;">🔒 Purchase lead to unlock details</div>
      </div>
    </div>
    <div class="cta-wrap">
      <a href="${viewUrl}" class="cta-btn">View &amp; Purchase Lead</a>
    </div>
    <p class="urgency">⏳ Only 3 contractors can claim this lead — act fast!</p>
  </div>
  <div class="footer">
    <p class="brand">HOMECRAFTER</p>
    <p>Connecting homeowners with trusted local professionals</p>
  </div>
</div>
</body>
</html>`;
}

async function sendBrevoEmail(to: string, toName: string, subject: string, htmlContent: string): Promise<void> {
  const res = await fetch(BREVO_ENDPOINT, {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'api-key': BREVO_API_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      sender: { name: 'Trent', email: 'trent@homecrafter.ai' },
      to: [{ email: to, name: toName }],
      subject,
      htmlContent,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Brevo API error ${res.status}: ${body}`);
  }
}

/**
 * Find matching contractors and send Brevo email notifications for a new lead.
 * Can be called directly from submit endpoint or via the notify-contractors API.
 */
export async function notifyContractorsViaBrevo(
  leadId: number,
  services: string[],
  zip: string
): Promise<{ matched: number; sent: number; errors: string[] }> {
  if (!BREVO_API_KEY) {
    console.warn('[brevo-notify] BREVO_API_KEY not configured, skipping');
    return { matched: 0, sent: 0, errors: ['BREVO_API_KEY not configured'] };
  }

  // Build category list
  const allCategories: string[] = [];
  for (const svc of services) {
    const cats = SERVICE_TO_CATEGORY[svc.toLowerCase()] || [svc.toLowerCase()];
    for (const c of cats) {
      if (!allCategories.includes(c)) allCategories.push(c);
    }
  }

  if (allCategories.length === 0) {
    return { matched: 0, sent: 0, errors: [] };
  }

  // Find matching contractors
  let matchedContractors: any[] = [];
  const coords = zip ? getZipCoords(zip) : null;

  if (coords) {
    matchedContractors = await sql`
      SELECT * FROM (
        SELECT id, name, email, category,
          (3958.8 * 2 * ASIN(SQRT(
            POWER(SIN(RADIANS(lat - ${coords.lat}) / 2), 2) +
            COS(RADIANS(${coords.lat})) * COS(RADIANS(lat)) *
            POWER(SIN(RADIANS(lng - ${coords.lng}) / 2), 2)
          ))) AS distance_miles
        FROM contractors
        WHERE category = ANY(${allCategories})
          AND email IS NOT NULL AND email != ''
          AND active = true
          AND lat IS NOT NULL
      ) sub
      WHERE distance_miles <= ${RADIUS_MILES}
      ORDER BY distance_miles ASC

    `;
  } else {
    matchedContractors = await sql`
      SELECT DISTINCT ON (email) id, name, email, category
      FROM contractors
      WHERE category = ANY(${allCategories})
        AND email IS NOT NULL AND email != ''
        AND active = true
      ORDER BY email

    `;
  }

  console.log(`[brevo-notify] Lead #${leadId}: ${matchedContractors.length} contractors matched (zip: ${zip}, categories: ${allCategories.join(',')})`);

  // Send emails
  let sent = 0;
  const errors: string[] = [];
  const serviceLabels = services.map(s => SERVICE_NAMES[s.toLowerCase()] || s).join(' & ');

  for (const contractor of matchedContractors) {
    try {
      const subject = `New ${serviceLabels} Lead in Your Area — HomeCrafter`;
      const html = buildEmailHtml(contractor.name, services, zip, leadId);
      await sendBrevoEmail(contractor.email, contractor.name, subject, html);
      sent++;
    } catch (e: any) {
      console.error(`[brevo-notify] Failed for ${contractor.email}:`, e.message);
      errors.push(`${contractor.name} (${contractor.email}): ${e.message}`);
    }
  }

  console.log(`[brevo-notify] Lead #${leadId}: ${sent}/${matchedContractors.length} emails sent via Brevo`);

  // Schedule follow-up notifications (12h and 48h)
  try {
    await scheduleFollowUps(leadId);
  } catch (e: any) {
    console.error(`[brevo-notify] Failed to schedule follow-ups for lead #${leadId}:`, e.message);
  }

  return { matched: matchedContractors.length, sent, errors };
}

/**
 * Adjust a Date to respect quiet hours (9 PM – 7:30 AM EST).
 * If the time falls in quiet hours, push to 7:30 AM next morning.
 */
function adjustForQuietHours(date: Date): Date {
  // Convert to EST components
  const estStr = date.toLocaleString('en-US', { timeZone: 'America/New_York' });
  const est = new Date(estStr);
  const hours = est.getHours();
  const minutes = est.getMinutes();
  const timeInMinutes = hours * 60 + minutes;

  const quietStart = 21 * 60;     // 9:00 PM = 1260 min
  const quietEnd = 7 * 60 + 30;   // 7:30 AM = 450 min

  if (timeInMinutes >= quietStart || timeInMinutes < quietEnd) {
    // In quiet hours — push to 7:30 AM EST
    // Calculate how many ms until 7:30 AM EST
    const estNow = est;
    const next730 = new Date(estNow);
    next730.setHours(7, 30, 0, 0);

    // If we're past midnight but before 7:30 AM, next730 is today
    // If we're past 9 PM, next730 is tomorrow
    if (timeInMinutes >= quietStart) {
      next730.setDate(next730.getDate() + 1);
    }

    // Convert back: find the offset between est and original UTC
    const offsetMs = date.getTime() - est.getTime();
    return new Date(next730.getTime() + offsetMs);
  }

  return date;
}

/**
 * Schedule 12h and 48h follow-up notification rows for a lead.
 */
async function scheduleFollowUps(leadId: number): Promise<void> {
  const now = new Date();

  const twelveHours = new Date(now.getTime() + 12 * 60 * 60 * 1000);
  const fortyEightHours = new Date(now.getTime() + 48 * 60 * 60 * 1000);

  const scheduled12h = adjustForQuietHours(twelveHours);
  const scheduled48h = adjustForQuietHours(fortyEightHours);

  await sql`
    INSERT INTO lead_notifications (lead_id, notification_type, scheduled_for, status)
    VALUES
      (${leadId}, 'reminder_12h', ${scheduled12h.toISOString()}, 'pending'),
      (${leadId}, 'reminder_48h', ${scheduled48h.toISOString()}, 'pending')
  `;

  console.log(`[brevo-notify] Scheduled follow-ups for lead #${leadId}: 12h=${scheduled12h.toISOString()}, 48h=${scheduled48h.toISOString()}`);
}
