// Run with: npx tsx scripts/migrate-stripe.ts
import sql from '../lib/db';

async function migrate() {
  // Create lead_credits table
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

  // Add index for fast lookups
  await sql`
    CREATE INDEX IF NOT EXISTS idx_lead_credits_pro_active
    ON lead_credits(pro_account_id) WHERE credits_remaining > 0
  `;

  // Add credit_id to lead_assignments if not exists
  try {
    await sql`ALTER TABLE lead_assignments ADD COLUMN IF NOT EXISTS credit_id INTEGER REFERENCES lead_credits(id)`;
  } catch (e) {
    console.log('credit_id column may already exist:', e);
  }

  // Add category to lead_assignments if not exists
  try {
    await sql`ALTER TABLE lead_assignments ADD COLUMN IF NOT EXISTS category VARCHAR(50)`;
  } catch (e) {
    console.log('category column may already exist:', e);
  }

  console.log('Migration complete!');
}

migrate().catch(console.error);
