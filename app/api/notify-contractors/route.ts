import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { notifyContractorsViaBrevo } from '@/lib/brevo-notify';

export async function POST(req: NextRequest) {
  try {
    const { lead_id } = await req.json();

    if (!lead_id) {
      return NextResponse.json({ error: 'lead_id required' }, { status: 400 });
    }

    // Fetch lead from DB
    const leads = await sql`SELECT * FROM leads WHERE id = ${lead_id}`;
    if (leads.length === 0) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    const lead = leads[0];
    const zip = lead.zip || '';
    const services: string[] = lead.services || [];

    const result = await notifyContractorsViaBrevo(lead_id, services, zip);

    return NextResponse.json({
      ok: true,
      lead_id,
      ...result,
    });
  } catch (e: any) {
    console.error('[notify-contractors] Error:', e);
    return NextResponse.json({ error: e.message || 'Internal error' }, { status: 500 });
  }
}
