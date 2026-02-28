import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';

// One-time migration endpoint. Delete after running.
// Hit GET /api/migrate-stripe?key=homecrafter-migrate-2024 to run.
export async function GET(request: NextRequest) {
  const key = new URL(request.url).searchParams.get('key');
  if (key !== 'homecrafter-migrate-2024') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS lead_credits (
        id SERIAL PRIMARY KEY,
        pro_account_id INTEGER NOT NULL REFERENCES pro_accounts(id),
        category VARCHAR(50) NOT NULL,
        bundle_type VARCHAR(50),
        credits_remaining INTEGER NOT NULL DEFAULT 0,
        purchased_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        stripe_session_id VARCHAR(255) UNIQUE
      )
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_lead_credits_pro_active
      ON lead_credits(pro_account_id) WHERE credits_remaining > 0
    `;

    // Add columns to lead_assignments if they don't exist
    try { await sql`ALTER TABLE lead_assignments ADD COLUMN IF NOT EXISTS credit_id INTEGER REFERENCES lead_credits(id)`; } catch {}
    try { await sql`ALTER TABLE lead_assignments ADD COLUMN IF NOT EXISTS category VARCHAR(50)`; } catch {}

    return NextResponse.json({ success: true, message: 'Migration complete. Delete this endpoint now.' });
  } catch (e) {
    console.error('Migration error:', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
