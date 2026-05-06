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

// POST — customer sends a message
export async function POST(request: NextRequest) {
  const body = await request.json();
  const token = body.token;
  const text = (body.message || '').trim();

  if (!token || !text || text.length > 2000) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const leads = await sql`
    SELECT id FROM crm_leads WHERE chat_token = ${token}
  `;
  if (leads.length === 0) {
    return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
  }

  const leadId = leads[0].id;

  await sql`
    INSERT INTO crm_activity (crm_lead_id, activity_type, description, is_from_customer)
    VALUES (${leadId}, 'sms', ${'📥 ' + text}, true)
  `;

  return NextResponse.json({ success: true });
}
