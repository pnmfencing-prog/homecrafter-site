import { NextRequest, NextResponse } from 'next/server';
import { verifyProToken } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { VALID_CATEGORIES, categoryMatchesBundle, VALID_BUNDLES } from '@/lib/pricing';
import sql from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    if (!rateLimit(`claim:${ip}`, 15, 60_000)) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    }

    const user = verifyProToken(request);
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json();
    const leadId = parseInt(body.leadId);
    const category = typeof body.category === 'string' ? body.category.toLowerCase().trim() : '';

    if (!leadId || !VALID_CATEGORIES.includes(category)) {
      return NextResponse.json({ error: 'Invalid lead ID or category' }, { status: 400 });
    }

    // Check lead exists
    const leads = await sql`
      SELECT id, homeowner_name, homeowner_email, homeowner_phone, address, zip, notes, services
      FROM leads WHERE id = ${leadId}
    `;
    if (leads.length === 0) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }
    const lead = leads[0];

    // Check max 3 assignments per lead per category
    const assignments = await sql`
      SELECT COUNT(*) as cnt FROM lead_assignments
      WHERE lead_id = ${leadId} AND category = ${category}
    `;
    if (parseInt(assignments[0].cnt) >= 3) {
      return NextResponse.json({ error: 'This lead has already been claimed by 3 contractors' }, { status: 409 });
    }

    // Check contractor hasn't already claimed this lead for this category
    const alreadyClaimed = await sql`
      SELECT id FROM lead_assignments
      WHERE lead_id = ${leadId} AND pro_account_id = ${user.id} AND category = ${category}
    `;
    if (alreadyClaimed.length > 0) {
      return NextResponse.json({ error: 'You already claimed this lead' }, { status: 409 });
    }

    // Find credits: direct category match OR matching paired bundle
    // Priority: exact category credits first, then bundle credits
    const credits = await sql`
      SELECT id, category, bundle_type, credits_remaining FROM lead_credits
      WHERE pro_account_id = ${user.id} AND credits_remaining > 0
      ORDER BY
        CASE WHEN category = ${category} AND bundle_type IS NULL THEN 0
             WHEN bundle_type IS NOT NULL THEN 1
             ELSE 2 END,
        purchased_at ASC
    `;

    let creditRow = null;
    for (const c of credits) {
      // Direct category match (non-bundle)
      if (c.category === category && !c.bundle_type) {
        creditRow = c;
        break;
      }
      // Paired bundle match
      if (c.bundle_type && categoryMatchesBundle(category, c.bundle_type)) {
        creditRow = c;
        break;
      }
    }

    if (!creditRow) {
      return NextResponse.json({
        error: 'No credits available for this category. Purchase a bundle first.',
        needsCredits: true,
      }, { status: 402 });
    }

    // Deduct 1 credit
    await sql`
      UPDATE lead_credits SET credits_remaining = credits_remaining - 1
      WHERE id = ${creditRow.id} AND credits_remaining > 0
    `;

    // Create assignment
    await sql`
      INSERT INTO lead_assignments (lead_id, pro_account_id, category, credit_id)
      VALUES (${leadId}, ${user.id}, ${category}, ${creditRow.id})
    `;

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
    console.error('Claim lead error:', e);
    return NextResponse.json({ error: 'Server error', debug: e?.message || 'Unknown' }, { status: 500 });
  }
}
