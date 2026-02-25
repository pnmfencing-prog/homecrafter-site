import { NextRequest, NextResponse } from 'next/server';
import { sendLeadNotification, sendHomeownerConfirmation } from '@/lib/email';

// Test contractor mapping — swap with DB later
const TEST_CONTRACTORS: Record<string, { email: string; name: string }> = {
  // Default test contractor for all services
  default: { email: 'jamholdinglimited@gmail.com', name: 'Test Contractor' },
};

export async function POST(req: NextRequest) {
  try {
    const data = await req.json();
    const submitted = data.submitted || new Date().toISOString();

    console.log(`New submission: ${data.name} - ${(data.services || []).join(', ')}`);

    const lead = {
      homeownerName: data.name || '',
      homeownerEmail: data.email || '',
      homeownerPhone: data.phone || '',
      address: data.address || '',
      services: data.services || [],
      notes: data.notes || '',
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

    return NextResponse.json({ 
      ok: true, 
      emails: emailResults 
    });
  } catch (e) {
    console.error('Submit error:', e);
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}
