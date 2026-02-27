import { NextRequest, NextResponse } from 'next/server';
import { sendLeadNotification, sendHomeownerConfirmation } from '@/lib/email';
import { rateLimit } from '@/lib/rate-limit';
import { escapeHtml } from '@/lib/sanitize';
import sql from '@/lib/db';
import { getZipCoords } from '@/lib/geo';

// Service name mapping
const SERVICE_NAMES: Record<string, string> = {
  fencing: 'FenceCrafter', roofing: 'RoofCrafter', windows: 'WindowCrafter',
  siding: 'SidingCrafter', painting: 'PaintCrafter', paint: 'PaintCrafter',
  locksmith: 'LockCrafter', housekeeper: 'CleanCrafter',
  woodflooring: 'FloorCrafter', carpet: 'CarpetCrafter', hvac: 'HVACCrafter',
  landscaping: 'LandscapeCrafter', irrigation: 'LandscapeCrafter',
  concrete: 'ConcreteCrafter', kitchen: 'KitchenCrafter', bathroom: 'BathroomCrafter',
  pestcontrol: 'PestCrafter', handyman: 'HandyCrafter',
  security: 'SecureCrafter'
};

// Category mapping for DB queries
const SERVICE_TO_CATEGORY: Record<string, string[]> = {
  fencing: ['fencing'],
  roofing: ['roofing'],
  windows: ['windows'],
  siding: ['siding'],
  painting: ['paint'],
  paint: ['paint'],
  locksmith: ['locksmith'],
  housekeeper: ['housekeeper'],
  woodflooring: ['woodflooring'],
  carpet: ['carpet'],
  hvac: ['hvac'],
  landscaping: ['landscaping', 'irrigation'],
  irrigation: ['landscaping', 'irrigation'],
  concrete: ['concrete'],
  kitchen: ['kitchen', 'bathroom'],
  bathroom: ['kitchen', 'bathroom'],
  pestcontrol: ['pestcontrol'],
  handyman: ['handyman'],
  security: ['security'],
};

const RADIUS_MILES = 30;
const MAX_CONTRACTORS = 3;

export async function POST(req: NextRequest) {
  try {
    // Rate limit: 3 submissions per IP per 10 minutes
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    if (!rateLimit(`submit:${ip}`, 3, 10 * 60 * 1000)) {
      return NextResponse.json({ error: 'Too many submissions. Please try again later.' }, { status: 429 });
    }

    const data = await req.json();

    // Honeypot check
    if (data.website_url) {
      return NextResponse.json({ ok: true, emails: { homeowner: true, contractor: true, errors: [] } });
    }

    // Basic validation
    if (!data.name || !data.email || !data.services?.length) {
      return NextResponse.json({ error: 'Name, email, and at least one service required' }, { status: 400 });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(data.email)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    }

    const submitted = data.submitted || new Date().toISOString();

    // Extract zip from address
    const zipMatch = (data.address || '').match(/\b(\d{5})\b/);
    const zip = zipMatch ? zipMatch[1] : '';

    // Save lead to database
    const leadResult = await sql`
      INSERT INTO leads (homeowner_name, homeowner_email, homeowner_phone, address, zip, services, notes, submitted_at)
      VALUES (${data.name}, ${data.email}, ${data.phone || ''}, ${data.address || ''}, ${zip}, ${data.services}, ${data.notes || ''}, ${submitted})
      RETURNING id
    `;
    const leadId = leadResult[0]?.id;

    console.log(`New lead #${leadId}: ${escapeHtml(data.name)} - ${data.services.join(', ')} - zip: ${zip}`);

    const lead = {
      homeownerName: escapeHtml(data.name || ''),
      homeownerEmail: data.email || '',
      homeownerPhone: escapeHtml(data.phone || ''),
      address: escapeHtml(data.address || ''),
      services: (data.services || []).map((s: string) => escapeHtml(s)),
      notes: escapeHtml(data.notes || ''),
      submitted,
    };

    const emailResults = { homeowner: false, contractors: 0, errors: [] as string[] };

    // 1. Confirmation email to homeowner
    if (lead.homeownerEmail) {
      try {
        await sendHomeownerConfirmation(lead.homeownerEmail, lead.homeownerName);
        emailResults.homeowner = true;
      } catch (e: any) {
        console.error('Homeowner email failed:', e.message);
        emailResults.errors.push(`homeowner: ${e.message}`);
      }
    }

    // 2. Find matching contractors by category + geo proximity
    const allCategories: string[] = [];
    for (const svc of data.services) {
      const cats = SERVICE_TO_CATEGORY[svc.toLowerCase()] || [svc.toLowerCase()];
      allCategories.push(...cats);
    }

    let matchedContractors: any[] = [];
    const coords = zip ? getZipCoords(zip) : null;

    if (coords) {
      // Geo-matched query: Haversine formula via subquery, within 30 miles
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
        ORDER BY distance_miles ASC, rating DESC NULLS LAST
        LIMIT ${MAX_CONTRACTORS}
      `;
    } else {
      // No zip or unknown zip — fall back to category-only match
      matchedContractors = await sql`
        SELECT DISTINCT ON (email) id, name, email, category
        FROM contractors
        WHERE category = ANY(${allCategories})
          AND email IS NOT NULL AND email != ''
          AND active = true
        ORDER BY email, rating DESC NULLS LAST
        LIMIT ${MAX_CONTRACTORS}
      `;
    }

    console.log(`Matched ${matchedContractors.length} contractors for lead #${leadId} (zip: ${zip}, geo: ${!!coords})`);

    // TODO: Remove test mode once Stripe billing is live
    const TEST_MODE = true;
    const TEST_EMAIL = 'jamholdinglimited@icloud.com';

    // Send lead notification to matched contractors
    for (const contractor of matchedContractors) {
      try {
        const sendTo = TEST_MODE ? TEST_EMAIL : contractor.email;
        const sendName = TEST_MODE ? 'HomeCrafter Team (Test)' : contractor.name;
        await sendLeadNotification(sendTo, sendName, lead);
        
        if (leadId) {
          await sql`
            INSERT INTO lead_assignments (lead_id, contractor_id, status)
            VALUES (${leadId}, ${contractor.id}, 'sent')
          `;
        }
        emailResults.contractors++;
      } catch (e: any) {
        console.error(`Contractor email failed (${contractor.email}):`, e.message);
        emailResults.errors.push(`contractor ${contractor.name}: ${e.message}`);
      }
    }

    // Fallback if no contractors matched
    if (matchedContractors.length === 0) {
      try {
        await sendLeadNotification('jamholdinglimited@icloud.com', 'HomeCrafter Team', lead);
        emailResults.contractors = 1;
      } catch (e: any) {
        emailResults.errors.push(`fallback: ${e.message}`);
      }
    }

    return NextResponse.json({ ok: true, leadId, emails: emailResults });
  } catch (e) {
    console.error('Submit error:', e);
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}
