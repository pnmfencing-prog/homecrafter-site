import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';

// GET — fetch messages for a chat token (customer-facing)
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  if (!token || token.length < 10) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 400 });
  }

  const leads = await sql`
    SELECT id, customer_name, service_type FROM crm_leads WHERE chat_token = ${token}
  `;
  if (leads.length === 0) {
    return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
  }
  const lead = leads[0];

  const messages = await sql`
    SELECT id, activity_type, description, is_from_customer, created_at
    FROM crm_activity
    WHERE crm_lead_id = ${lead.id} AND activity_type = 'sms'
    ORDER BY created_at ASC
  `;

  return NextResponse.json({
    lead: { name: lead.customer_name, service: lead.service_type },
    messages: messages.map((m: any) => {
      const description = m.description || '';
      const hasOutboundPrefix = description.startsWith('📤');
      const hasInboundPrefix = description.startsWith('📥');
      return {
        id: m.id,
        text: description.replace(/^(📤|📥)\s*/, '').replace(/^Scheduled SMS sent:\s*/i, ''),
        // Prefix is the source of truth when present. This keeps staff replies
        // dark/right even if an older row was accidentally flagged inbound.
        fromCustomer: hasInboundPrefix ? true : hasOutboundPrefix ? false : m.is_from_customer,
        time: m.created_at,
      };
    }),
  });
}

function isAdmin(request: NextRequest): boolean {
  const auth = request.headers.get('authorization') || '';
  const token = auth.replace('Bearer ', '');
  return token === (process.env.ADMIN_TOKEN || 'hc-admin-2026');
}

// POST — customer or staff sends a message
export async function POST(request: NextRequest) {
  const body = await request.json();
  const token = body.token;
  const text = (body.message || '').trim();
  const fromStaff = body.fromStaff === true;

  if (!token || !text || text.length > 2000) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  if (fromStaff && !isAdmin(request)) {
    return NextResponse.json({ error: 'Unauthorized staff message' }, { status: 401 });
  }

  const leads = await sql`
    SELECT id FROM crm_leads WHERE chat_token = ${token}
  `;
  if (leads.length === 0) {
    return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
  }

  const leadId = leads[0].id;
  const desc = (fromStaff ? '📤 ' : '📥 ') + text;

  await sql`
    INSERT INTO crm_activity (crm_lead_id, activity_type, description, is_from_customer, created_by)
    VALUES (${leadId}, 'sms', ${desc}, ${!fromStaff}, ${fromStaff ? 'staff_chat' : 'customer_chat'})
  `;

  await sql`
    UPDATE crm_leads
    SET updated_at = NOW(), last_message_by = ${fromStaff ? 'you' : 'customer'}, last_message_at = NOW(), is_read = ${fromStaff}
    WHERE id = ${leadId}
  `;

  return NextResponse.json({ success: true });
}
