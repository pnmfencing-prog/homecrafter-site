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
  locksmith: 1, // TEMP: $1 for testing, restore to 24 housekeeper: 45, woodflooring: 55, carpet: 55, hvac: 66,
  landscaping: 54, irrigation: 54, concrete: 54, kitchen: 80, bathroom: 80,
  pestcontrol: 48, handyman: 40, security: 55
};

export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!rateLimit(`leads:${ip}`, 20, 60 * 1000)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  const { searchParams } = new URL(req.url);
  const category = searchParams.get('category'); // filter by service
  const limit = Math.min(parseInt(searchParams.get('limit') || '20') || 20, 50);

  // Fetch recent leads (public browsing — no contact details)
  const leads = category
    ? await sql`
        SELECT id, zip, services, notes, submitted_at,
          (SELECT COUNT(*) FROM lead_assignments WHERE lead_id = leads.id) as assignments
        FROM leads
        WHERE ${category} = ANY(services)
        ORDER BY submitted_at DESC
        LIMIT ${limit}
      `
    : await sql`
        SELECT id, zip, services, notes, submitted_at,
          (SELECT COUNT(*) FROM lead_assignments WHERE lead_id = leads.id) as assignments
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
    const noteText = l.notes ? (l.notes.length > 80 ? l.notes.slice(0, 80) + '...' : l.notes) : '';

    // If filtering by category, only show that specific service entry
    const servicesToShow = category ? [category] : svcs;

    servicesToShow.forEach((svc: string) => {
      const svcLower = svc.toLowerCase();
      const serviceName = SERVICE_NAMES[svc] || SERVICE_NAMES[svcLower] || svc;
      const price = SERVICE_PRICES[svc] || SERVICE_PRICES[svcLower] || 45;

      results.push({
        id: `${l.id}-${svcLower}`,
        leadId: l.id,
        zip: l.zip || 'NJ',
        services: [serviceName],
        servicePrimary: serviceName,
        notes: noteText,
        price,
        spots: { taken: parseInt(l.assignments) || 0, total: 3 },
        hoursLeft,
        isNew: hoursAgo <= 6,
        isClosing: hoursLeft <= 12 && hoursLeft > 0,
        submitted: l.submitted_at,
      });
    });
  });

  // Sort by newest first
  results.sort((a, b) => new Date(b.submitted).getTime() - new Date(a.submitted).getTime());

  return NextResponse.json({ leads: results, total: results.length });
}
