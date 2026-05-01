import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';

function isAdmin(request: NextRequest): boolean {
  const auth = request.headers.get('authorization') || '';
  const token = auth.replace('Bearer ', '');
  return token === (process.env.ADMIN_TOKEN || 'hc-admin-2026');
}

export async function GET(request: NextRequest) {
  if (!isAdmin(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date'); // specific date
  const month = searchParams.get('month'); // YYYY-MM
  const status = searchParams.get('status');

  if (date) {
    const events = await sql`
      SELECT ce.*, cl.customer_name, cl.customer_phone, cl.customer_email, cl.service_type, p.estimate_no AS proposal_estimate_no
      FROM calendar_events ce
      LEFT JOIN crm_leads cl ON ce.crm_lead_id = cl.id
      LEFT JOIN proposals p ON ce.proposal_id = p.id
      WHERE ce.event_date = ${date}
      ORDER BY ce.event_time ASC NULLS LAST
    `;
    return NextResponse.json({ events });
  }

  if (month) {
    const startDate = `${month}-01`;
    const events = await sql`
      SELECT ce.*, cl.customer_name, cl.customer_phone, cl.customer_email, cl.service_type, p.estimate_no AS proposal_estimate_no
      FROM calendar_events ce
      LEFT JOIN crm_leads cl ON ce.crm_lead_id = cl.id
      LEFT JOIN proposals p ON ce.proposal_id = p.id
      WHERE ce.event_date >= ${startDate}::date 
        AND ce.event_date < (${startDate}::date + INTERVAL '1 month')
      ORDER BY ce.event_date ASC, ce.event_time ASC NULLS LAST
    `;
    return NextResponse.json({ events });
  }

  // Date range query (for feed view)
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  if (from && to && searchParams.get('missed') !== 'true') {
    const events = await sql`
      SELECT ce.*, cl.customer_name, cl.customer_phone, cl.customer_email, cl.service_type, p.estimate_no AS proposal_estimate_no
      FROM calendar_events ce
      LEFT JOIN crm_leads cl ON ce.crm_lead_id = cl.id
      LEFT JOIN proposals p ON ce.proposal_id = p.id
      WHERE ce.event_date >= ${from}::date AND ce.event_date <= ${to}::date
      ORDER BY ce.event_date ASC, ce.event_time ASC NULLS LAST
    `;
    return NextResponse.json({ events });
  }

  // Missed/overdue events
  const missed = searchParams.get('missed');
  if (missed === 'true') {
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    let events;
    if (from && to) {
      events = await sql`
        SELECT ce.*, cl.customer_name, cl.customer_phone, cl.customer_email, p.estimate_no AS proposal_estimate_no
        FROM calendar_events ce
        LEFT JOIN crm_leads cl ON ce.crm_lead_id = cl.id
      LEFT JOIN proposals p ON ce.proposal_id = p.id
        WHERE ce.status IN ('missed', 'scheduled') AND (ce.event_date < CURRENT_DATE OR (ce.event_date = CURRENT_DATE AND ce.event_time < LOCALTIME))
          AND ce.event_date >= ${from}::date AND ce.event_date <= ${to}::date
        ORDER BY ce.event_date DESC
      `;
    } else {
      events = await sql`
        SELECT ce.*, cl.customer_name, cl.customer_phone, cl.customer_email, p.estimate_no AS proposal_estimate_no
        FROM calendar_events ce
        LEFT JOIN crm_leads cl ON ce.crm_lead_id = cl.id
      LEFT JOIN proposals p ON ce.proposal_id = p.id
        WHERE ce.status IN ('missed', 'scheduled') AND (ce.event_date < CURRENT_DATE OR (ce.event_date = CURRENT_DATE AND ce.event_time < LOCALTIME))
        ORDER BY ce.event_date DESC
        LIMIT 50
      `;
    }
    return NextResponse.json({ events });
  }

  // Default: upcoming 14 days
  const events = await sql`
    SELECT ce.*, cl.customer_name, cl.customer_phone, cl.customer_email, cl.service_type, p.estimate_no AS proposal_estimate_no
    FROM calendar_events ce
    LEFT JOIN crm_leads cl ON ce.crm_lead_id = cl.id
      LEFT JOIN proposals p ON ce.proposal_id = p.id
    WHERE ce.event_date >= CURRENT_DATE
      AND ce.event_date <= CURRENT_DATE + INTERVAL '14 days'
    ORDER BY ce.event_date ASC, ce.event_time ASC NULLS LAST
  `;
  
  // Also get overdue
  const overdue = await sql`
    SELECT ce.*, cl.customer_name, cl.customer_phone, cl.customer_email, p.estimate_no AS proposal_estimate_no
    FROM calendar_events ce
    LEFT JOIN crm_leads cl ON ce.crm_lead_id = cl.id
      LEFT JOIN proposals p ON ce.proposal_id = p.id
    WHERE (ce.event_date < (NOW() AT TIME ZONE 'America/New_York')::date OR (ce.event_date = (NOW() AT TIME ZONE 'America/New_York')::date AND ce.event_time < (NOW() AT TIME ZONE 'America/New_York')::time)) AND ce.status IN ('scheduled', 'missed')
    ORDER BY ce.event_date DESC
    LIMIT 10
  `;
  
  return NextResponse.json({ events, overdue });
}

export async function POST(request: NextRequest) {
  if (!isAdmin(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { action } = body;

  if (action === 'create') {
    const result = await sql`
      INSERT INTO calendar_events (title, description, event_type, event_date, event_time, end_time, all_day, crm_lead_id, location, customer_id)
      VALUES (${body.title}, ${body.description || null}, ${body.event_type || 'appointment'}, 
              ${body.event_date}, ${body.event_time || null}, ${body.end_time || null},
              ${body.all_day || false}, ${body.crm_lead_id || null}, ${body.location || null}, ${body.customer_id || null})
      RETURNING *
    `;
    return NextResponse.json({ success: true, event: result[0] });
  }

  if (action === 'update') {
    const { id, ...fields } = body;
    if (fields.title !== undefined) await sql`UPDATE calendar_events SET title = ${fields.title}, updated_at = NOW() WHERE id = ${id}`;
    if (fields.event_date !== undefined) await sql`UPDATE calendar_events SET event_date = ${fields.event_date}, updated_at = NOW() WHERE id = ${id}`;
    if (fields.event_time !== undefined) await sql`UPDATE calendar_events SET event_time = ${fields.event_time}, updated_at = NOW() WHERE id = ${id}`;
    if (fields.status !== undefined) await sql`UPDATE calendar_events SET status = ${fields.status}, updated_at = NOW() WHERE id = ${id}`;
    if (fields.location !== undefined) await sql`UPDATE calendar_events SET location = ${fields.location}, updated_at = NOW() WHERE id = ${id}`;
    if (fields.description !== undefined) await sql`UPDATE calendar_events SET description = ${fields.description}, updated_at = NOW() WHERE id = ${id}`;
    if (fields.event_type !== undefined) await sql`UPDATE calendar_events SET event_type = ${fields.event_type}, updated_at = NOW() WHERE id = ${id}`;
    if (fields.end_time !== undefined) await sql`UPDATE calendar_events SET end_time = ${fields.end_time}, updated_at = NOW() WHERE id = ${id}`;
    if (fields.all_day !== undefined) await sql`UPDATE calendar_events SET all_day = ${fields.all_day}, updated_at = NOW() WHERE id = ${id}`;
    if (fields.crm_lead_id !== undefined) await sql`UPDATE calendar_events SET crm_lead_id = ${fields.crm_lead_id}, updated_at = NOW() WHERE id = ${id}`;
    if (fields.proposal_id !== undefined) await sql`UPDATE calendar_events SET proposal_id = ${fields.proposal_id}, updated_at = NOW() WHERE id = ${id}`;
    if (fields.customer_id !== undefined) await sql`UPDATE calendar_events SET customer_id = ${fields.customer_id}, updated_at = NOW() WHERE id = ${id}`;

    if (fields.crm_lead_id) {
      if (fields.customer_name !== undefined) await sql`UPDATE crm_leads SET customer_name = ${fields.customer_name || null}, updated_at = NOW() WHERE id = ${fields.crm_lead_id}`;
      if (fields.customer_phone !== undefined) await sql`UPDATE crm_leads SET customer_phone = ${fields.customer_phone || null}, updated_at = NOW() WHERE id = ${fields.crm_lead_id}`;
      if (fields.customer_email !== undefined) await sql`UPDATE crm_leads SET customer_email = ${fields.customer_email || null}, updated_at = NOW() WHERE id = ${fields.crm_lead_id}`;
    }
    return NextResponse.json({ success: true });
  }

  if (action === 'complete') {
    await sql`UPDATE calendar_events SET status = 'completed', updated_at = NOW() WHERE id = ${body.id}`;
    return NextResponse.json({ success: true });
  }

  if (action === 'cancel') {
    await sql`UPDATE calendar_events SET status = 'cancelled', updated_at = NOW() WHERE id = ${body.id}`;
    return NextResponse.json({ success: true });
  }

  if (action === 'delete') {
    await sql`DELETE FROM calendar_events WHERE id = ${body.id}`;
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
