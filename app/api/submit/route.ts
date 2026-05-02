import { NextRequest, NextResponse } from 'next/server';
import { sendHomeownerConfirmation } from '@/lib/email';
import { rateLimit } from '@/lib/rate-limit';
import { escapeHtml } from '@/lib/sanitize';
import sql from '@/lib/db';
import { notifyContractorsViaBrevo } from '@/lib/brevo-notify';

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

    // Save lead to database (details column stores category-specific answers)
    const details = data.details && Object.keys(data.details).length > 0 ? JSON.stringify(data.details) : null;
    const leadResult = await sql`
      INSERT INTO leads (homeowner_name, homeowner_email, homeowner_phone, address, zip, services, notes, details, submitted_at)
      VALUES (${data.name}, ${data.email}, ${data.phone || ''}, ${data.address || ''}, ${zip}, ${data.services}, ${data.notes || ''}, ${details}, ${submitted})
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
      details: data.details || {},
      submitted,
    };

    const emailResults = { homeowner: false, contractors: 0, sms: 0, errors: [] as string[] };

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

    // 2. Notify matching contractors by email + SMS.
    // Do NOT create lead_assignments here — that table represents claimed/purchased spots.
    if (leadId) {
      try {
        const notifyResult = await notifyContractorsViaBrevo(leadId, data.services, zip);
        emailResults.contractors = notifyResult.sent;
        emailResults.sms = notifyResult.smsSent;
        emailResults.errors.push(...notifyResult.errors);
      } catch (e: any) {
        console.error(`[brevo-notify] Error for lead #${leadId}:`, e.message);
        emailResults.errors.push(`contractors: ${e.message}`);
      }
    }

    return NextResponse.json({ ok: true, leadId, emails: emailResults });
  } catch (e) {
    console.error('Submit error:', e);
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}
