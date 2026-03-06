import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { getZipCoords } from '@/lib/geo';
import {
  build12hReminderHtml,
  build48hReminderHtml,
  get12hSubject,
  get48hSubject,
} from '@/lib/followup-emails';

const BREVO_API_KEY = process.env.BREVO_API_KEY || '';
const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';
const RADIUS_MILES = 40;
const CRON_SECRET = process.env.CRON_SECRET || '';

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

function isWithinSendingHours(): boolean {
  const now = new Date();
  const estStr = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
  const est = new Date(estStr);
  const hours = est.getHours();
  const minutes = est.getMinutes();
  const timeInMinutes = hours * 60 + minutes;

  const startTime = 7 * 60 + 30;  // 7:30 AM = 450 min
  const endTime = 21 * 60;        // 9:00 PM = 1260 min

  return timeInMinutes >= startTime && timeInMinutes < endTime;
}

export async function GET(request: Request) {
  // Optional auth check
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get('secret');
  if (CRON_SECRET && secret !== CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!BREVO_API_KEY) {
    return NextResponse.json({ error: 'BREVO_API_KEY not configured' }, { status: 500 });
  }

  // Check if we're within sending hours
  if (!isWithinSendingHours()) {
    return NextResponse.json({
      message: 'Outside sending hours (7:30 AM - 9:00 PM EST)',
      processed: 0,
      sent: 0,
      skipped: 0,
    });
  }

  // Get pending notifications that are due
  const pendingNotifications = await sql`
    SELECT
      ln.id as notification_id,
      ln.lead_id,
      ln.notification_type,
      ln.scheduled_for,
      l.services,
      l.zip,
      l.status as lead_status,
      l.submitted_at
    FROM lead_notifications ln
    JOIN leads l ON l.id = ln.lead_id
    WHERE ln.status = 'pending'
      AND ln.scheduled_for <= NOW()
    ORDER BY ln.scheduled_for ASC
    LIMIT 50
  `;

  let sent = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const notif of pendingNotifications) {
    // Skip if lead is no longer 'new' (already purchased/assigned/closed)
    if (notif.lead_status !== 'new') {
      await sql`
        UPDATE lead_notifications
        SET status = 'skipped', sent_at = NOW()
        WHERE id = ${notif.notification_id}
      `;
      skipped++;
      continue;
    }

    // Check if lead has expired (72h from submission)
    const submittedAt = new Date(notif.submitted_at);
    const expiryTime = submittedAt.getTime() + 72 * 60 * 60 * 1000;
    if (Date.now() > expiryTime) {
      await sql`
        UPDATE lead_notifications
        SET status = 'skipped', sent_at = NOW()
        WHERE id = ${notif.notification_id}
      `;
      skipped++;
      continue;
    }

    // Find matching contractors (same logic as initial notification)
    const services: string[] = notif.services || [];
    const zip: string = notif.zip || '';

    const SERVICE_TO_CATEGORY: Record<string, string[]> = {
      fencing: ['fencing'], roofing: ['roofing'], windows: ['windows'],
      siding: ['siding'], painting: ['paint'], paint: ['paint'],
      locksmith: ['locksmith'], housekeeper: ['housekeeper'],
      woodflooring: ['woodflooring'], carpet: ['carpet'], hvac: ['hvac'],
      landscaping: ['landscaping', 'irrigation'], irrigation: ['landscaping', 'irrigation'],
      concrete: ['concrete'], kitchen: ['kitchen', 'bathroom'], bathroom: ['kitchen', 'bathroom'],
      pestcontrol: ['pestcontrol'], handyman: ['handyman'], security: ['security'],
    };

    const allCategories: string[] = [];
    for (const svc of services) {
      const cats = SERVICE_TO_CATEGORY[svc.toLowerCase()] || [svc.toLowerCase()];
      for (const c of cats) {
        if (!allCategories.includes(c)) allCategories.push(c);
      }
    }

    if (allCategories.length === 0) {
      await sql`
        UPDATE lead_notifications SET status = 'skipped', sent_at = NOW()
        WHERE id = ${notif.notification_id}
      `;
      skipped++;
      continue;
    }

    // Find contractors
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

    // Build email content based on notification type
    let emailsSentForNotif = 0;
    for (const contractor of matchedContractors) {
      try {
        let subject: string;
        let html: string;

        if (notif.notification_type === 'reminder_12h') {
          subject = get12hSubject(services);
          html = build12hReminderHtml(contractor.name, services, zip, notif.lead_id, submittedAt);
        } else {
          subject = get48hSubject(services);
          html = build48hReminderHtml(contractor.name, services, zip, notif.lead_id, submittedAt);
        }

        await sendBrevoEmail(contractor.email, contractor.name, subject, html);
        emailsSentForNotif++;
      } catch (e: any) {
        console.error(`[send-followups] Failed for ${contractor.email}:`, e.message);
        errors.push(`${contractor.name}: ${e.message}`);
      }
    }

    // Mark notification as sent
    await sql`
      UPDATE lead_notifications
      SET status = 'sent', sent_at = NOW()
      WHERE id = ${notif.notification_id}
    `;
    sent++;

    console.log(`[send-followups] ${notif.notification_type} for lead #${notif.lead_id}: ${emailsSentForNotif} emails sent to contractors`);
  }

  return NextResponse.json({
    processed: pendingNotifications.length,
    sent,
    skipped,
    errors: errors.length > 0 ? errors : undefined,
  });
}
