import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';

function isAdmin(request: NextRequest): boolean {
  const auth = request.headers.get('authorization') || '';
  const token = auth.replace('Bearer ', '');
  return token === (process.env.ADMIN_TOKEN || 'hc-admin-2026');
}

export async function GET(request: NextRequest) {
  if (!isAdmin(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const source = searchParams.get('source');
  const search = searchParams.get('search');
  const id = searchParams.get('id');

  // Single lead with activity
  if (id) {
    const leads = await sql`SELECT * FROM crm_leads WHERE id = ${parseInt(id)}`;
    if (leads.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const leadId = parseInt(id);
    const activity = await sql`SELECT * FROM crm_activity WHERE crm_lead_id = ${leadId} ORDER BY created_at DESC LIMIT 50`;
    return NextResponse.json({ lead: leads[0], activity });
  }

  // Build filtered query using tagged templates
  let leads;
  if (status && status !== 'all' && search) {
    const searchPat = `%${search}%`;
    leads = await sql`SELECT * FROM crm_leads WHERE status = ${status} AND (customer_name ILIKE ${searchPat} OR customer_phone ILIKE ${searchPat} OR customer_email ILIKE ${searchPat} OR customer_address ILIKE ${searchPat}) ORDER BY created_at DESC`;
  } else if (status && status !== 'all') {
    leads = await sql`SELECT * FROM crm_leads WHERE status = ${status} ORDER BY created_at DESC`;
  } else if (source && source !== 'all' && search) {
    const searchPat = `%${search}%`;
    leads = await sql`SELECT * FROM crm_leads WHERE source = ${source} AND (customer_name ILIKE ${searchPat} OR customer_phone ILIKE ${searchPat} OR customer_email ILIKE ${searchPat} OR customer_address ILIKE ${searchPat}) ORDER BY created_at DESC`;
  } else if (source && source !== 'all') {
    leads = await sql`SELECT * FROM crm_leads WHERE source = ${source} ORDER BY created_at DESC`;
  } else if (search) {
    const searchPat = `%${search}%`;
    leads = await sql`SELECT * FROM crm_leads WHERE customer_name ILIKE ${searchPat} OR customer_phone ILIKE ${searchPat} OR customer_email ILIKE ${searchPat} OR customer_address ILIKE ${searchPat} ORDER BY created_at DESC`;
  } else {
    leads = await sql`SELECT * FROM crm_leads ORDER BY created_at DESC`;
  }

  const stats = await sql`
    SELECT 
      count(*) FILTER (WHERE status = 'new')::int as new_count,
      count(*) FILTER (WHERE status = 'contacted')::int as contacted_count,
      count(*) FILTER (WHERE status = 'quoted')::int as quoted_count,
      count(*) FILTER (WHERE status = 'scheduled')::int as scheduled_count,
      count(*) FILTER (WHERE status = 'won')::int as won_count,
      count(*) FILTER (WHERE status = 'lost')::int as lost_count,
      count(*)::int as total,
      coalesce(sum(job_value) FILTER (WHERE status = 'won'), 0)::numeric as total_revenue,
      coalesce(sum(quoted_amount) FILTER (WHERE status IN ('quoted','scheduled')), 0)::numeric as pipeline_value
    FROM crm_leads
  `;

  return NextResponse.json({ leads, stats: stats[0] });
}

export async function POST(request: NextRequest) {
  if (!isAdmin(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { action } = body;

  if (action === 'create') {
    const result = await sql`
      INSERT INTO crm_leads (customer_name, customer_phone, customer_email, customer_address, customer_city, customer_state, customer_zip, service_type, notes, source)
      VALUES (${body.customer_name || null}, ${body.customer_phone || null}, ${body.customer_email || null}, ${body.customer_address || null}, ${body.customer_city || null}, ${body.customer_state || null}, ${body.customer_zip || null}, ${body.service_type || null}, ${body.notes || null}, ${body.source || 'manual'})
      RETURNING *
    `;
    await sql`INSERT INTO crm_activity (crm_lead_id, activity_type, description) VALUES (${result[0].id}, 'status_change', 'Lead created')`;
    return NextResponse.json({ success: true, lead: result[0] });
  }

  if (action === 'update_status') {
    const { id, status, lost_reason } = body;
    await sql`UPDATE crm_leads SET status = ${status}, updated_at = NOW() WHERE id = ${id}`;

    if (status === 'contacted') await sql`UPDATE crm_leads SET contacted_at = NOW() WHERE id = ${id}`;
    if (status === 'quoted') await sql`UPDATE crm_leads SET quoted_at = NOW() WHERE id = ${id}`;
    if (status === 'scheduled') await sql`UPDATE crm_leads SET scheduled_at = NOW() WHERE id = ${id}`;
    if (status === 'won') await sql`UPDATE crm_leads SET completed_at = NOW() WHERE id = ${id}`;
    if (status === 'lost') {
      await sql`UPDATE crm_leads SET closed_at = NOW() WHERE id = ${id}`;
      if (lost_reason) await sql`UPDATE crm_leads SET lost_reason = ${lost_reason} WHERE id = ${id}`;
    }

    const desc = 'Status changed to ' + status;
    await sql`INSERT INTO crm_activity (crm_lead_id, activity_type, description) VALUES (${id}, 'status_change', ${desc})`;
    return NextResponse.json({ success: true });
  }

  if (action === 'update') {
    const { id, quoted_amount, job_value, assigned_to, next_follow_up, notes, service_type } = body;
    if (quoted_amount !== undefined) await sql`UPDATE crm_leads SET quoted_amount = ${quoted_amount}, updated_at = NOW() WHERE id = ${id}`;
    if (job_value !== undefined) await sql`UPDATE crm_leads SET job_value = ${job_value}, updated_at = NOW() WHERE id = ${id}`;
    if (assigned_to !== undefined) await sql`UPDATE crm_leads SET assigned_to = ${assigned_to}, updated_at = NOW() WHERE id = ${id}`;
    if (next_follow_up !== undefined) await sql`UPDATE crm_leads SET next_follow_up = ${next_follow_up}, updated_at = NOW() WHERE id = ${id}`;
    if (notes !== undefined) await sql`UPDATE crm_leads SET notes = ${notes}, updated_at = NOW() WHERE id = ${id}`;
    if (service_type !== undefined) await sql`UPDATE crm_leads SET service_type = ${service_type}, updated_at = NOW() WHERE id = ${id}`;
    return NextResponse.json({ success: true });
  }

  if (action === 'add_note') {
    const { id, activity_type, description } = body;
    await sql`INSERT INTO crm_activity (crm_lead_id, activity_type, description) VALUES (${id}, ${activity_type || 'note'}, ${description})`;
    await sql`UPDATE crm_leads SET updated_at = NOW() WHERE id = ${id}`;
    return NextResponse.json({ success: true });
  }

  if (action === 'delete') {
    await sql`DELETE FROM crm_leads WHERE id = ${body.id}`;
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
