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
  if (valid.length > 10) {
    return NextResponse.json({ error: 'Maximum 10 trades' }, { status: 400 });
  }

  await sql`UPDATE pro_accounts SET categories = ${valid}, service = ${valid[0]} WHERE email = ${email}`;

  return NextResponse.json({ success: true, categories: valid });
}
