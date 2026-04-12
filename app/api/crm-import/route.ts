import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';

function isAdmin(request: NextRequest): boolean {
  const auth = request.headers.get('authorization') || '';
  const token = auth.replace('Bearer ', '');
  return token === (process.env.ADMIN_TOKEN || 'hc-admin-2026');
}

export async function POST(request: NextRequest) {
  if (!isAdmin(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const rows = body.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'No rows provided' }, { status: 400 });
  }

  let imported = 0;
  let skipped = 0;
  let errors: string[] = [];

  for (const row of rows) {
    try {
      const name = (row.name || row.customer_name || row.Name || row['Full Name'] || row['First Name'] || '').trim();
      const phone = (row.phone || row.customer_phone || row.Phone || row['Phone 1'] || row['Mobile'] || '').trim();
      const email = (row.email || row.customer_email || row.Email || row['Email 1'] || '').trim();
      const address = (row.address || row.customer_address || row.Address || row['Property Address'] || row['Street Address'] || '').trim();
      const city = (row.city || row.customer_city || row.City || '').trim();
      const state = (row.state || row.customer_state || row.State || 'NJ').trim();
      const zip = (row.zip || row.customer_zip || row.Zip || row['Zip Code'] || '').trim();
      const service = (row.service || row.service_type || row.Service || 'Fencing').trim();
      const source = (row.source || row.Source || 'csv-import').trim();
      const notes = (row.notes || row.Notes || '').trim();

      if (!name && !phone && !email) {
        skipped++;
        continue;
      }

      // Dedup by phone or email
      if (phone) {
        const existing = await sql`SELECT id FROM crm_leads WHERE customer_phone = ${phone} LIMIT 1`;
        if (existing.length > 0) { skipped++; continue; }
      }
      if (email) {
        const existing = await sql`SELECT id FROM crm_leads WHERE customer_email = ${email} LIMIT 1`;
        if (existing.length > 0) { skipped++; continue; }
      }

      const chatToken = [...Array(16)].map(() => Math.random().toString(36)[2]).join('');

      await sql`
        INSERT INTO crm_leads (customer_name, customer_phone, customer_email, customer_address, customer_city, customer_state, customer_zip, service_type, notes, source, chat_token)
        VALUES (${name || null}, ${phone || null}, ${email || null}, ${address || null}, ${city || null}, ${state}, ${zip || null}, ${service}, ${notes || null}, ${source}, ${chatToken})
      `;
      imported++;
    } catch (e: any) {
      errors.push(e?.message || 'Unknown error');
    }
  }

  return NextResponse.json({ success: true, imported, skipped, errors: errors.slice(0, 5), total: rows.length });
}
