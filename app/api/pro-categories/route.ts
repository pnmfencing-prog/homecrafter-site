import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import sql from '@/lib/db';

const JWT_SECRET = process.env.JWT_SECRET || 'hc-pro-secret-change-in-production';

const VALID_CATEGORIES = [
  'Bathroom', 'Carpet', 'Concrete', 'Fencing', 'Handyman', 'Housekeeper',
  'HVAC', 'Irrigation', 'Kitchen', 'Landscaping', 'Locksmith', 'Paint',
  'PestControl', 'PowerWashing', 'Roofing', 'Security', 'Siding', 'Solar',
  'Windows', 'WoodFlooring',
];

function getProEmail(req: NextRequest): string | null {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { email: string };
    return decoded.email || null;
  } catch {
    return null;
  }
}

// GET — fetch current categories
export async function GET(req: NextRequest) {
  const email = getProEmail(req);
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const accounts = await sql`SELECT categories, service FROM pro_accounts WHERE email = ${email}`;
  if (accounts.length === 0) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

  const categories = accounts[0].categories?.length > 0
    ? accounts[0].categories
    : (accounts[0].service ? [accounts[0].service] : []);

  return NextResponse.json({
    categories,
    available: VALID_CATEGORIES,
  });
}

// PUT — update categories
export async function PUT(req: NextRequest) {
  const email = getProEmail(req);
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const categories: string[] = body.categories || [];

  // Validate
  const valid = categories.filter(c => VALID_CATEGORIES.includes(c));
  if (valid.length === 0) {
    return NextResponse.json({ error: 'Select at least one trade' }, { status: 400 });
  }
  if (valid.length > 20) {
    return NextResponse.json({ error: 'Maximum 20 trades' }, { status: 400 });
  }

  await sql`UPDATE pro_accounts SET categories = ${valid}, service = ${valid[0]} WHERE email = ${email}`;

  // Sync contractors table — remove old category rows for this email, add new ones
  // Get contractor info to preserve other fields
  const existing = await sql`
    SELECT DISTINCT ON (LOWER(email)) name, phone, website, address, city, state, zip, rating, reviews, lat, lng
    FROM contractors WHERE LOWER(email) = LOWER(${email}) LIMIT 1
  `;

  if (existing.length > 0) {
    const c = existing[0];
    // Delete old entries for this email
    await sql`DELETE FROM contractors WHERE LOWER(email) = LOWER(${email})`;
    // Insert one row per selected category
    for (const cat of valid) {
      await sql`
        INSERT INTO contractors (name, email, phone, website, address, city, state, zip, category, rating, reviews, lat, lng, active)
        VALUES (${c.name}, ${email}, ${c.phone}, ${c.website}, ${c.address}, ${c.city}, ${c.state}, ${c.zip}, ${cat}, ${c.rating}, ${c.reviews}, ${c.lat}, ${c.lng}, true)
      `;
    }
    console.log(`[pro-categories] Synced ${valid.length} categories for ${email} in contractors table`);
  }

  return NextResponse.json({ success: true, categories: valid });
}
