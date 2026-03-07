import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';

const VALID_CATEGORIES = [
  'Bathroom', 'Carpet', 'Concrete', 'Fencing', 'Handyman', 'Housekeeper',
  'HVAC', 'Irrigation', 'Kitchen', 'Landscaping', 'Locksmith', 'Paint',
  'PestControl', 'PowerWashing', 'Roofing', 'Security', 'Siding', 'Solar',
  'Windows', 'WoodFlooring',
];

// GET — fetch current categories
export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sessions = await sql`SELECT pro_account_id FROM pro_sessions WHERE token = ${token} AND expires_at > NOW()`;
  if (sessions.length === 0) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });

  const proId = sessions[0].pro_account_id;
  const accounts = await sql`SELECT categories, service FROM pro_accounts WHERE id = ${proId}`;
  if (accounts.length === 0) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

  const categories = accounts[0].categories || (accounts[0].service ? [accounts[0].service] : []);

  return NextResponse.json({
    categories,
    available: VALID_CATEGORIES,
  });
}

// PUT — update categories
export async function PUT(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sessions = await sql`SELECT pro_account_id FROM pro_sessions WHERE token = ${token} AND expires_at > NOW()`;
  if (sessions.length === 0) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });

  const proId = sessions[0].pro_account_id;
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

  await sql`UPDATE pro_accounts SET categories = ${valid}, service = ${valid[0]} WHERE id = ${proId}`;

  return NextResponse.json({ success: true, categories: valid });
}
