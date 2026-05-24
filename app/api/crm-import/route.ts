import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';

function isAdmin(request: NextRequest): boolean {
  const auth = request.headers.get('authorization') || '';
  const token = auth.replace('Bearer ', '');
  return token === (process.env.ADMIN_TOKEN || 'hc-admin-2026');
}

function value(row: any, keys: string[]): string {
  for (const key of keys) {
    const found = Object.keys(row || {}).find((k) => k.toLowerCase().trim() === key.toLowerCase().trim());
    if (found && row[found] != null && String(row[found]).trim()) return String(row[found]).trim();
  }
  return '';
}

function cleanEmail(input: string): string {
  const first = String(input || '').split(/[;,]/)[0].trim().toLowerCase();
  if (!first || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(first)) return '';
  if (first.endsWith('@domain.com') || ['user@domain.com', 'name@domain.com', 'example@yourmail.com', 'info@sitename.com'].includes(first)) return '';
  return first;
}

function cleanPhone(input: string): string {
  let digits = String(input || '').replace(/\D+/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  return digits.length >= 10 ? digits : '';
}

function titleCaseName(input: string): string {
  return String(input || '').trim().toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(Llc|Inc|Co)\b/g, (m) => m.toUpperCase());
}

function chatToken(): string {
  return [...Array(16)].map(() => Math.random().toString(36)[2]).join('');
}

async function ensureImportSchema() {
  await sql`
    CREATE TABLE IF NOT EXISTS crm_import_batches (
      id SERIAL PRIMARY KEY,
      batch_name TEXT NOT NULL,
      original_filename TEXT,
      provider TEXT NOT NULL DEFAULT 'BatchLeads',
      market TEXT,
      search_criteria TEXT,
      source TEXT NOT NULL DEFAULT 'batchleads',
      campaign_id INTEGER REFERENCES crm_campaigns(id) ON DELETE SET NULL,
      total_rows INTEGER NOT NULL DEFAULT 0,
      imported_count INTEGER NOT NULL DEFAULT 0,
      duplicate_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'processing',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS crm_import_rows (
      id SERIAL PRIMARY KEY,
      batch_id INTEGER NOT NULL REFERENCES crm_import_batches(id) ON DELETE CASCADE,
      row_number INTEGER NOT NULL,
      raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
      normalized_name TEXT,
      normalized_phone TEXT,
      normalized_email TEXT,
      normalized_address TEXT,
      normalized_city TEXT,
      normalized_state TEXT,
      normalized_zip TEXT,
      status TEXT NOT NULL,
      lead_id INTEGER REFERENCES crm_leads(id) ON DELETE SET NULL,
      duplicate_lead_id INTEGER REFERENCES crm_leads(id) ON DELETE SET NULL,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS import_batch_id INTEGER REFERENCES crm_import_batches(id) ON DELETE SET NULL`;
}

async function findDuplicate(phone: string, email: string, name: string, address: string) {
  if (phone) {
    const rows = await sql`SELECT id FROM crm_leads WHERE regexp_replace(COALESCE(customer_phone,''), '[^0-9]', '', 'g') = ${phone} LIMIT 1`;
    if (rows.length) return rows[0].id;
  }
  if (email) {
    const rows = await sql`SELECT id FROM crm_leads WHERE LOWER(customer_email) = ${email} LIMIT 1`;
    if (rows.length) return rows[0].id;
  }
  if (name && address) {
    const rows = await sql`SELECT id FROM crm_leads WHERE LOWER(customer_name) = LOWER(${name}) AND LOWER(COALESCE(customer_address,'')) = LOWER(${address}) LIMIT 1`;
    if (rows.length) return rows[0].id;
  }
  return null;
}

export async function POST(request: NextRequest) {
  if (!isAdmin(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureImportSchema();

  const body = await request.json();
  const rows = body.rows;
  if (!Array.isArray(rows) || rows.length === 0) return NextResponse.json({ error: 'No rows provided' }, { status: 400 });

  const batchName = String(body.batch_name || body.batchName || body.filename || `BatchLeads ${new Date().toISOString().slice(0, 10)}`).trim();
  const source = String(body.source || 'batchleads').trim().toLowerCase() || 'batchleads';
  const campaignId = body.campaign_id ? Number(body.campaign_id) : null;
  const serviceDefault = String(body.service_type || body.service || 'Fencing').trim();

  const batchRows = await sql`
    INSERT INTO crm_import_batches (batch_name, original_filename, provider, market, search_criteria, source, campaign_id, total_rows, status)
    VALUES (${batchName}, ${body.filename || null}, ${body.provider || 'BatchLeads'}, ${body.market || null}, ${body.search_criteria || null}, ${source}, ${campaignId}, ${rows.length}, 'processing')
    RETURNING id
  `;
  const batchId = batchRows[0].id;

  let imported = 0;
  let duplicate = 0;
  let skipped = 0;
  let errorCount = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      const rawName = value(row, ['name', 'customer_name', 'Full Name', 'Owner Name', 'First Name']);
      const first = value(row, ['First Name', 'FirstName']);
      const last = value(row, ['Last Name', 'LastName']);
      const name = titleCaseName(rawName || [first, last].filter(Boolean).join(' '));
      const phone = cleanPhone(value(row, ['phone', 'customer_phone', 'Phone', 'Phone 1', 'Mobile', 'Mobile Phone', 'Wireless 1']));
      const email = cleanEmail(value(row, ['email', 'customer_email', 'Email', 'Email 1']));
      const address = value(row, ['address', 'customer_address', 'Address', 'Property Address', 'Street Address', 'Mailing Address']);
      const city = value(row, ['city', 'customer_city', 'City']);
      const state = value(row, ['state', 'customer_state', 'State']) || 'NJ';
      const zip = value(row, ['zip', 'customer_zip', 'Zip', 'Zip Code', 'Postal Code']);
      const service = value(row, ['service', 'service_type', 'Service']) || serviceDefault;
      const rowNotes = value(row, ['notes', 'Notes']);
      const notes = [rowNotes, `Import batch: ${batchName}`].filter(Boolean).join('\n');

      if (!name && !phone && !email) {
        skipped++;
        await sql`
          INSERT INTO crm_import_rows (batch_id, row_number, raw_data, status, error)
          VALUES (${batchId}, ${i + 1}, ${JSON.stringify(row)}::jsonb, 'skipped', 'Missing name, phone, and email')
        `;
        continue;
      }

      const dupeId = await findDuplicate(phone, email, name, address);
      if (dupeId) {
        duplicate++;
        await sql`
          INSERT INTO crm_import_rows (batch_id, row_number, raw_data, normalized_name, normalized_phone, normalized_email, normalized_address, normalized_city, normalized_state, normalized_zip, status, duplicate_lead_id)
          VALUES (${batchId}, ${i + 1}, ${JSON.stringify(row)}::jsonb, ${name || null}, ${phone || null}, ${email || null}, ${address || null}, ${city || null}, ${state || null}, ${zip || null}, 'duplicate', ${dupeId})
        `;
        await sql`INSERT INTO crm_activity (crm_lead_id, activity_type, description) VALUES (${dupeId}, 'note', ${`Seen again in import batch: ${batchName}`})`;
        continue;
      }

      const maxCode = await sql`SELECT COALESCE(MAX(CAST(lead_code AS INTEGER)), 99) + 1 as next_code FROM crm_leads WHERE lead_code ~ '^[0-9]+$'`;
      const leadCode = String(maxCode[0].next_code);
      const lead = await sql`
        INSERT INTO crm_leads (customer_name, customer_phone, customer_email, customer_address, customer_city, customer_state, customer_zip, service_type, notes, source, status, chat_token, lead_code, campaign_id, import_batch_id)
        VALUES (${name || null}, ${phone || null}, ${email || null}, ${address || null}, ${city || null}, ${state || null}, ${zip || null}, ${service}, ${notes || null}, ${source}, 'new', ${chatToken()}, ${leadCode}, ${campaignId}, ${batchId})
        RETURNING id
      `;
      imported++;
      await sql`
        INSERT INTO crm_import_rows (batch_id, row_number, raw_data, normalized_name, normalized_phone, normalized_email, normalized_address, normalized_city, normalized_state, normalized_zip, status, lead_id)
        VALUES (${batchId}, ${i + 1}, ${JSON.stringify(row)}::jsonb, ${name || null}, ${phone || null}, ${email || null}, ${address || null}, ${city || null}, ${state || null}, ${zip || null}, 'imported', ${lead[0].id})
      `;
      await sql`INSERT INTO crm_activity (crm_lead_id, activity_type, description) VALUES (${lead[0].id}, 'status_change', ${`Lead imported from ${batchName}`})`;
    } catch (e: any) {
      errorCount++;
      errors.push(e?.message || 'Unknown error');
      await sql`
        INSERT INTO crm_import_rows (batch_id, row_number, raw_data, status, error)
        VALUES (${batchId}, ${i + 1}, ${JSON.stringify(row || {})}::jsonb, 'error', ${e?.message || 'Unknown error'})
      `;
    }
  }

  await sql`
    UPDATE crm_import_batches
    SET imported_count = ${imported}, duplicate_count = ${duplicate}, skipped_count = ${skipped}, error_count = ${errorCount}, status = 'completed', updated_at = NOW()
    WHERE id = ${batchId}
  `;

  return NextResponse.json({ success: true, batch_id: batchId, imported, skipped, duplicate, errors: errors.slice(0, 5), total: rows.length });
}
