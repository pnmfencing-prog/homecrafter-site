import { NextResponse } from 'next/server';
import sql from '@/lib/db';

export async function GET() {
  try {
    const services = await sql`SELECT DISTINCT unnest(services) as service FROM leads ORDER BY service`;
    const contractors = await sql`SELECT id, first_name || ' ' || last_name as name, company FROM pro_accounts ORDER BY first_name, last_name`;

    return NextResponse.json({
      services: services.map((r: any) => r.service),
      contractors: contractors.map((r: any) => ({ id: r.id, name: r.name, company: r.company }))
    });
  } catch (err: any) {
    console.error('Admin filters error:', err);
    return NextResponse.json({ error: 'Failed to load filters' }, { status: 500 });
  }
}
