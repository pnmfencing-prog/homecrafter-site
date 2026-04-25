import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';

function isAdmin(request: NextRequest) {
  const auth = request.headers.get('authorization') || '';
  const token = auth.replace('Bearer ', '');
  return token === (process.env.ADMIN_TOKEN || 'hc-admin-2026');
}

export async function GET(request: NextRequest) {
  if (!isAdmin(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  
  const { searchParams } = new URL(request.url);
  const search = searchParams.get('search');
  const id = searchParams.get('id');
  
  if (id) {
    const customer = await sql`SELECT * FROM customers WHERE id = ${id}`;
    if (!customer.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    
    // Get related proposals and events
    const proposals = await sql`SELECT id, estimate_no, status, total, created_at FROM proposals WHERE customer_id = ${id} ORDER BY created_at DESC`;
    const events = await sql`SELECT id, title, event_date, event_type, status FROM calendar_events WHERE customer_id = ${id} ORDER BY event_date DESC`;
    
    return NextResponse.json({ customer: customer[0], proposals, events });
  }
  
  if (search) {
    const q = `%${search}%`;
    const customers = await sql`
      SELECT * FROM customers 
      WHERE LOWER(name) LIKE LOWER(${q}) OR phone LIKE ${q} OR LOWER(email) LIKE LOWER(${q}) OR code LIKE UPPER(${q})
      ORDER BY name
    `;
    return NextResponse.json({ customers });
  }
  
  const customers = await sql`SELECT * FROM customers ORDER BY code`;
  return NextResponse.json({ customers });
}

export async function POST(request: NextRequest) {
  if (!isAdmin(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  
  const body = await request.json();
  const { action } = body;
  
  if (action === 'create' || action === 'find_or_create') {
    const name = (body.name || '').trim();
    if (!name) return NextResponse.json({ error: 'Name required' }, { status: 400 });
    
    // Check if customer exists by exact name match
    if (action === 'find_or_create') {
      const existing = await sql`SELECT * FROM customers WHERE LOWER(name) = LOWER(${name}) LIMIT 1`;
      if (existing.length) {
        // Update phone/email if provided and missing
        if (body.phone && !existing[0].phone) {
          await sql`UPDATE customers SET phone = ${body.phone}, updated_at = NOW() WHERE id = ${existing[0].id}`;
          existing[0].phone = body.phone;
        }
        if (body.email && !existing[0].email) {
          await sql`UPDATE customers SET email = ${body.email}, updated_at = NOW() WHERE id = ${existing[0].id}`;
          existing[0].email = body.email;
        }
        return NextResponse.json({ success: true, customer: existing[0], created: false });
      }
    }
    
    // Generate next code
    const maxCode = await sql`SELECT code FROM customers ORDER BY code DESC LIMIT 1`;
    let nextNum = 1;
    if (maxCode.length) {
      const num = parseInt(maxCode[0].code.replace('C', ''));
      nextNum = num + 1;
    }
    const code = 'C' + String(nextNum).padStart(3, '0');
    
    const result = await sql`
      INSERT INTO customers (code, name, phone, email, address, city, state, zip, notes)
      VALUES (${code}, ${name}, ${body.phone || null}, ${body.email || null}, 
              ${body.address || null}, ${body.city || null}, ${body.state || null}, ${body.zip || null}, ${body.notes || null})
      RETURNING *
    `;
    return NextResponse.json({ success: true, customer: result[0], created: true });
  }
  
  if (action === 'update') {
    const { id, ...fields } = body;
    if (fields.name) await sql`UPDATE customers SET name = ${fields.name}, updated_at = NOW() WHERE id = ${id}`;
    if (fields.phone !== undefined) await sql`UPDATE customers SET phone = ${fields.phone}, updated_at = NOW() WHERE id = ${id}`;
    if (fields.email !== undefined) await sql`UPDATE customers SET email = ${fields.email}, updated_at = NOW() WHERE id = ${id}`;
    if (fields.address !== undefined) await sql`UPDATE customers SET address = ${fields.address}, updated_at = NOW() WHERE id = ${id}`;
    if (fields.notes !== undefined) await sql`UPDATE customers SET notes = ${fields.notes}, updated_at = NOW() WHERE id = ${id}`;
    return NextResponse.json({ success: true });
  }
  
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
