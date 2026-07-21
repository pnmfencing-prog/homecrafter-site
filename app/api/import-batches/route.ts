import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { normalizeCrmProfile } from '@/lib/email-policy';

function isAdmin(request: NextRequest): boolean {
  const auth = request.headers.get('authorization') || '';
  const token = auth.replace('Bearer ', '');
  return token === (process.env.ADMIN_TOKEN || 'hc-admin-2026');
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
      status TEXT NOT NULL DEFAULT 'completed',
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
  await sql`ALTER TABLE crm_import_batches ADD COLUMN IF NOT EXISTS crm_profile TEXT NOT NULL DEFAULT 'fencecrafters'`;
  await sql`ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS crm_profile TEXT NOT NULL DEFAULT 'fencecrafters'`;
}

export async function GET(request: NextRequest) {
  if (!isAdmin(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureImportSchema();

  const id = request.nextUrl.searchParams.get('id');
  const profile = normalizeCrmProfile(request.nextUrl.searchParams.get('profile'));
  if (id) {
    const batches = await sql`
      SELECT b.*, c.name AS campaign_name
      FROM crm_import_batches b
      LEFT JOIN crm_campaigns c ON c.id = b.campaign_id
      WHERE b.id = ${Number(id)}
        AND COALESCE(b.crm_profile, 'fencecrafters') = ${profile}
      LIMIT 1
    `;
    if (!batches.length) return NextResponse.json({ error: 'Import batch not found' }, { status: 404 });
    const rows = await sql`
      SELECT r.*, COALESCE(l.lead_code, dl.lead_code) AS lead_code,
             COALESCE(l.customer_name, dl.customer_name) AS crm_customer_name
      FROM crm_import_rows r
      LEFT JOIN crm_leads l ON l.id = r.lead_id
      LEFT JOIN crm_leads dl ON dl.id = r.duplicate_lead_id
      WHERE r.batch_id = ${Number(id)}
      ORDER BY r.row_number ASC
      LIMIT 1000
    `;
    return NextResponse.json({ batch: batches[0], rows });
  }

  const batches = await sql`
    SELECT b.*, c.name AS campaign_name
    FROM crm_import_batches b
    LEFT JOIN crm_campaigns c ON c.id = b.campaign_id
    WHERE COALESCE(b.crm_profile, 'fencecrafters') = ${profile}
    ORDER BY b.created_at DESC
    LIMIT 100
  `;
  return NextResponse.json({ batches });
}
