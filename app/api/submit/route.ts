import { NextRequest, NextResponse } from 'next/server';
import { sendLeadNotification, sendHomeownerConfirmation } from '@/lib/email';
import { rateLimit } from '@/lib/rate-limit';
import { escapeHtml } from '@/lib/sanitize';
import sql from '@/lib/db';

// Service name mapping
const SERVICE_NAMES: Record<string, string> = {
  fencing: 'FenceCrafter', roofing: 'RoofCrafter', windows: 'WindowCrafter',
  siding: 'SidingCrafter', painting: 'PaintCrafter', paint: 'PaintCrafter'
};

// Category mapping for DB queries
const SERVICE_TO_CATEGORY: Record<string, string[]> = {
  fencing: ['fencing'],
  roofing: ['roofing', 'roofing,siding', 'roofing, siding'],
  windows: ['windows', 'siding,windows', 'windows, siding', 'siding,siding,windows'],
  siding: ['siding', 'roofing,siding', 'roofing, siding', 'siding,windows', 'windows, siding', 'siding,siding,windows'],
  painting: ['paint'],
};

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

    // Extract zip from address (basic regex for 5-digit zip)
    const zipMatch = (data.address || '').match(/\b(\d{5})\b/);
    const zip = zipMatch ? zipMatch[1] : '';

    // Save lead to database
    const leadResult = await sql`
      INSERT INTO leads (homeowner_name, homeowner_email, homeowner_phone, address, zip, services, notes, submitted_at)
      VALUES (${data.name}, ${data.email}, ${data.phone || ''}, ${data.address || ''}, ${zip}, ${data.services}, ${data.notes || ''}, ${submitted})
      RETURNING id
    `;
    const leadId = leadResult[0]?.id;

    console.log(`New lead #${leadId}: ${escapeHtml(data.name)} - ${data.services.join(', ')}`);

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

    // 2. Find matching contractors from DB (up to 3 per service)
    const allCategories: string[] = [];
    for (const svc of data.services) {
      const cats = SERVICE_TO_CATEGORY[svc] || [svc];
      allCategories.push(...cats);
    }

    // Query contractors that match the categories and have email
    const matchedContractors = await sql`
      SELECT DISTINCT ON (email) id, name, email, category
      FROM contractors
      WHERE category = ANY(${allCategories})
        AND email IS NOT NULL 
        AND email != ''
        AND active = true
      ORDER BY email, rating DESC NULLS LAST
      LIMIT 3
    `;

    // Send lead notification to matched contractors
    for (const contractor of matchedContractors) {
      try {
        await sendLeadNotification(contractor.email, contractor.name, lead);
        
        // Record the assignment
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

    // If no contractors matched (no emails in DB), send to fallback
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
