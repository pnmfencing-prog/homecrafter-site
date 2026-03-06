import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';

const SERVICE_PRICES: Record<string, number> = {
  Fencing: 45, Roofing: 65, Windows: 65, Siding: 65, Paint: 49,
  Locksmith: 24, Housekeeper: 45, WoodFlooring: 55, Carpet: 55, HVAC: 66,
  Landscaping: 54, Irrigation: 54, Concrete: 54, Kitchen: 80, Bathroom: 80,
  PestControl: 48, Handyman: 40, Security: 55, Solar: 70, PowerWashing: 45,
};

const SERVICE_LABELS: Record<string, string> = {
  Fencing: 'FenceCrafter', Roofing: 'RoofCrafter', Windows: 'WindowCrafter',
  Siding: 'SidingCrafter', Paint: 'PaintCrafter', Locksmith: 'LockCrafter',
  Housekeeper: 'CleanCrafter', WoodFlooring: 'FloorCrafter', Carpet: 'CarpetCrafter',
  HVAC: 'HVACCrafter', Landscaping: 'LandscapeCrafter', Irrigation: 'LandscapeCrafter',
  Concrete: 'ConcreteCrafter', Kitchen: 'KitchenCrafter', Bathroom: 'BathroomCrafter',
  PestControl: 'PestCrafter', Handyman: 'HandyCrafter', Security: 'SecureCrafter',
  Solar: 'SolarCrafter', PowerWashing: 'WashCrafter',
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  const leads = await sql`
    SELECT id, zip, services, notes, submitted_at, details,
      (SELECT COUNT(*) FROM lead_assignments WHERE lead_id = leads.id) as assignments
    FROM leads
    WHERE id = ${id}
  `;

  if (leads.length === 0) {
    return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
  }

  const lead = leads[0];
  const services: string[] = lead.services || [];
  const primaryService = services[0] || '';
  const price = SERVICE_PRICES[primaryService] || 49;
  const maxSpots = 3;
  const taken = Number(lead.assignments) || 0;
  const submittedAt = new Date(lead.submitted_at);
  const expiresAt = new Date(submittedAt.getTime() + 72 * 60 * 60 * 1000);
  const hoursLeft = Math.max(0, Math.round((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60)));

  return NextResponse.json({
    id: lead.id,
    zip: lead.zip || '',
    services: services.map(s => ({
      key: s,
      label: SERVICE_LABELS[s] || s,
    })),
    notes: lead.notes || '',
    details: lead.details || {},
    price,
    spots: { total: maxSpots, taken, available: maxSpots - taken },
    hoursLeft,
    submittedAt: submittedAt.toISOString(),
    // NO contact info exposed — name, email, phone, address are all hidden
  });
}
