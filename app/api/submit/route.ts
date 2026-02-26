import { NextRequest, NextResponse } from 'next/server';
import { sendLeadNotification, sendHomeownerConfirmation } from '@/lib/email';
import { rateLimit } from '@/lib/rate-limit';
import { escapeHtml } from '@/lib/sanitize';

// Test contractor mapping — swap with DB later
const TEST_CONTRACTORS: Record<string, { email: string; name: string }> = {
  default: { email: 'jamholdinglimited@icloud.com', name: 'Test Contractor' },
};

export async function POST(req: NextRequest) {
  try {
    // Rate limit: 3 submissions per IP per 10 minutes
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    if (!rateLimit(`submit:${ip}`, 3, 10 * 60 * 1000)) {
      return NextResponse.json(
        { error: 'Too many submissions. Please try again later.' },
        { status: 429 }
      );
    }

    const data = await req.json();

    // Honeypot check — hidden field should be empty
    if (data.website_url) {
      // Bot filled in the honeypot field — silently accept but don't process
      return NextResponse.json({ ok: true, emails: { homeowner: true, contractor: true, errors: [] } });
    }

    // Basic validation
    if (!data.name || !data.email || !data.services?.length) {
      return NextResponse.json({ error: 'Name, email, and at least one service required' }, { status: 400 });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(data.email)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    }

    const submitted = data.submitted || new Date().toISOString();

    console.log(`New submission: ${escapeHtml(data.name)} - ${(data.services || []).join(', ')}`);

    const lead = {
      homeownerName: escapeHtml(data.name || ''),
      homeownerEmail: data.email || '',
      homeownerPhone: escapeHtml(data.phone || ''),
      address: escapeHtml(data.address || ''),
      services: (data.services || []).map((s: string) => escapeHtml(s)),
      notes: escapeHtml(data.notes || ''),
      submitted,
    };

    // Send emails (don't let email failures break the submission)
    const emailResults = { homeowner: false, contractor: false, errors: [] as string[] };

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

    // 2. Lead notification to contractor(s)
    const contractor = TEST_CONTRACTORS.default;
    try {
      await sendLeadNotification(contractor.email, contractor.name, lead);
      emailResults.contractor = true;
    } catch (e: any) {
      console.error('Contractor email failed:', e.message);
      emailResults.errors.push(`contractor: ${e.message}`);
    }

    return NextResponse.json({ ok: true, emails: emailResults });
  } catch (e) {
    console.error('Submit error:', e);
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}
