import { NextRequest, NextResponse } from 'next/server';
import { verifyProToken } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import sql from '@/lib/db';
import { sendHomeownerMatchEmail } from '@/lib/email';

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    if (!rateLimit(`claim-free:${ip}`, 10, 60_000)) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    }

    const user = verifyProToken(request);
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json();
    const leadId = parseInt(body.leadId);
    const category = typeof body.category === 'string' ? body.category.toLowerCase().trim() : '';

    if (!leadId) {
      return NextResponse.json({ error: 'Invalid lead ID' }, { status: 400 });
    }

    const leads = await sql`
      SELECT id, homeowner_name, homeowner_email, homeowner_phone, address, zip, notes, services
      FROM leads WHERE id = ${leadId}
    `;
    if (leads.length === 0) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }
    const lead = leads[0];

    // CRITICAL: Only allow free claim if ZERO paid purchases exist
    const paidAssignments = await sql`
      SELECT COUNT(*)::int as cnt FROM lead_assignments WHERE lead_id = ${leadId}
    `;
    if ((paidAssignments[0]?.cnt || 0) > 0) {
      return NextResponse.json({ error: 'This lead has been purchased — free claim not available' }, { status: 403 });
    }

    // Check if contractor already claimed
    const alreadyClaimed = await sql`
      SELECT id FROM lead_assignments
      WHERE lead_id = ${leadId} AND pro_account_id = ${user.id}
    `;
    if (alreadyClaimed.length > 0) {
      return NextResponse.json({ error: 'You already claimed this lead' }, { status: 409 });
    }

    // Create free assignment (credit_id = NULL means free)
    await sql`
      INSERT INTO lead_assignments (lead_id, pro_account_id, category, credit_id)
      VALUES (${leadId}, ${user.id}, ${category}, NULL)
    `;

    sendHomeownerMatchEmail(leadId, user.id, category).catch(() => {});

    return NextResponse.json({
      success: true,
      lead: {
        id: lead.id,
        firstName: lead.homeowner_name,
        lastName: '',
        email: lead.homeowner_email,
        phone: lead.homeowner_phone,
        address: lead.address,
        city: '',
        state: '',
        zip: lead.zip,
        notes: lead.notes,
        services: lead.services,
      },
    });
  } catch (e: any) {
    console.error('Free claim error:', e);
    return NextResponse.json({ error: 'Server error', debug: e?.message || 'Unknown' }, { status: 500 });
  }
}
