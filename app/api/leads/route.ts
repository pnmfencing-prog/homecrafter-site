import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import sql from '@/lib/db';

const SERVICE_NAMES: Record<string, string> = {
  fencing: 'FenceCrafter', roofing: 'RoofCrafter', windows: 'WindowCrafter',
  siding: 'SidingCrafter', painting: 'PaintCrafter', paint: 'PaintCrafter',
  locksmith: 'LockCrafter', housekeeper: 'CleanCrafter',
  woodflooring: 'FloorCrafter', carpet: 'CarpetCrafter', hvac: 'HVACCrafter',
  landscaping: 'LandscapeCrafter', irrigation: 'LandscapeCrafter',
  concrete: 'ConcreteCrafter', kitchen: 'KitchenCrafter', bathroom: 'BathroomCrafter',
  pestcontrol: 'PestCrafter', handyman: 'HandyCrafter', security: 'SecureCrafter'
};

const SERVICE_PRICES: Record<string, number> = {
  fencing: 45, roofing: 65, windows: 65, siding: 65, painting: 49, paint: 49,
  locksmith: 24, housekeeper: 45, woodflooring: 55, carpet: 55, hvac: 66,
  landscaping: 54, irrigation: 54, concrete: 54, kitchen: 80, bathroom: 80,
  pestcontrol: 48, handyman: 40, security: 55
};

const INTRO_PRICES: Record<string, number> = {
  fencing: 19, roofing: 24, windows: 24, siding: 24, painting: 19, paint: 19,
  locksmith: 10, housekeeper: 19, woodflooring: 22, carpet: 22, hvac: 24,
  landscaping: 22, irrigation: 22, concrete: 22, kitchen: 29, bathroom: 29,
  pestcontrol: 20, handyman: 17, security: 22
};

const INTRO_PRICING_EXPIRES = new Date('2026-04-09T23:59:59-04:00');
const introActive = new Date() < INTRO_PRICING_EXPIRES;

export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!rateLimit(`leads:${ip}`, 20, 60 * 1000)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  const { searchParams } = new URL(req.url);
  const category = searchParams.get('category'); // filter by service
  const limit = Math.min(parseInt(searchParams.get('limit') || '20') || 20, 50);

  // Fetch recent leads (public browsing — no contact details)
  // Include: active leads (within 72h OR sold out within last 24h)
  const leads = category
    ? await sql`
        SELECT id, zip, services, notes, submitted_at,
          (SELECT COUNT(*) FROM lead_assignments WHERE lead_id = leads.id) as assignments,
          (SELECT MAX(sent_at) FROM lead_assignments WHERE lead_id = leads.id) as last_assignment_at
        FROM leads
        WHERE ${category} = ANY(services)
        ORDER BY submitted_at DESC
        LIMIT ${limit}
      `
    : await sql`
        SELECT id, zip, services, notes, submitted_at,
          (SELECT COUNT(*) FROM lead_assignments WHERE lead_id = leads.id) as assignments,
          (SELECT MAX(sent_at) FROM lead_assignments WHERE lead_id = leads.id) as last_assignment_at
        FROM leads
        ORDER BY submitted_at DESC
        LIMIT ${limit}
      `;

  // Split multi-service leads into one entry per service
  const results: any[] = [];
  leads.forEach((l: any) => {
    const svcs = l.services || [];
    const hoursAgo = Math.round((Date.now() - new Date(l.submitted_at).getTime()) / 3600000);
    const hoursLeft = Math.max(0, 72 - hoursAgo);
    const taken = parseInt(l.assignments) || 0;
    const maxSpots = 3;
    const isSoldOut = taken >= maxSpots;
    const isExpired = hoursLeft <= 0;

    // Visibility rules:
    // 1. Sold out (3/3) → show for 24h after last assignment, then hide
    // 2. Expired (72h) with unsold spots → hide immediately
    if (isSoldOut) {
      const lastAssignment = l.last_assignment_at ? new Date(l.last_assignment_at) : new Date(l.submitted_at);
      const hoursSinceSoldOut = (Date.now() - lastAssignment.getTime()) / 3600000;
      if (hoursSinceSoldOut > 24) return; // Hide after 24h
    } else if (isExpired) {
      return; // Hide expired unsold leads
    }

    const noteText = l.notes ? (l.notes.length > 80 ? l.notes.slice(0, 80) + '...' : l.notes) : '';

    // If filtering by category, only show that specific service entry
    const servicesToShow = category ? [category] : svcs;

    servicesToShow.forEach((svc: string) => {
      const svcLower = svc.toLowerCase();
      const serviceName = SERVICE_NAMES[svc] || SERVICE_NAMES[svcLower] || svc;
      const fullPrice = SERVICE_PRICES[svc] || SERVICE_PRICES[svcLower] || 45;
      const introPrice = introActive ? (INTRO_PRICES[svc] || INTRO_PRICES[svcLower] || null) : null;
      const price = introPrice ?? fullPrice;

      results.push({
        id: `${l.id}-${svcLower}`,
        leadId: l.id,
        zip: l.zip || 'NJ',
        services: [serviceName],
        servicePrimary: serviceName,
        notes: noteText,
        price,
        fullPrice: introActive ? fullPrice : undefined,
        introActive,
        spots: { taken, total: maxSpots },
        hoursLeft,
        isSoldOut,
        isNew: hoursAgo <= 6 && !isSoldOut,
        isClosing: hoursLeft <= 12 && hoursLeft > 0 && !isSoldOut,
        submitted: l.submitted_at,
      });
    });
  });

  // Sort by newest first
  results.sort((a, b) => new Date(b.submitted).getTime() - new Date(a.submitted).getTime());

  return NextResponse.json({ leads: results, total: results.length });
}
