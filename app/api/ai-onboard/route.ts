import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { sanitizeCsvField } from '@/lib/sanitize';
import sql from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    // Rate limit: 3 per IP per 10 minutes
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    if (!rateLimit(`ai-onboard:${ip}`, 3, 10 * 60 * 1000)) {
      return NextResponse.json({ error: 'Too many submissions' }, { status: 429 });
    }

    const data = await req.json();

    await sql`
      INSERT INTO ai_onboard (business_name, owner_name, phone, email, services, service_area, pricing, hours, website, challenge, plan)
      VALUES (
        ${sanitizeCsvField(data.businessName || '')},
        ${sanitizeCsvField(data.ownerName || '')},
        ${sanitizeCsvField(data.phone || '')},
        ${sanitizeCsvField(data.email || '')},
        ${sanitizeCsvField((data.services || []).join('; '))},
        ${sanitizeCsvField(data.serviceArea || '')},
        ${sanitizeCsvField(data.pricing || '')},
        ${sanitizeCsvField(data.hours || '')},
        ${sanitizeCsvField(data.website || '')},
        ${sanitizeCsvField(data.challenge || '')},
        ${sanitizeCsvField(data.plan || '')}
      )
    `;

    console.log(`AI onboard: ${data.businessName} - ${data.plan}`);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('AI onboard error:', e);
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}
