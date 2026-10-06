-- Durable CRM invoices ledger (2026-10-06)
CREATE TABLE IF NOT EXISTS crm_invoices (
  id SERIAL PRIMARY KEY,
  crm_lead_id INTEGER NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,
  crm_profile TEXT NOT NULL DEFAULT 'fencecrafters',
  invoice_no TEXT,
  description TEXT NOT NULL,
  amount NUMERIC(12,2),
  amount_pending BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','paid','void')),
  paid_at TIMESTAMPTZ,
  payment_note TEXT,
  payment_reference TEXT,
  pdf_path TEXT,
  proposal_id INTEGER REFERENCES proposals(id) ON DELETE SET NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_crm_invoices_lead ON crm_invoices(crm_lead_id);
CREATE INDEX IF NOT EXISTS idx_crm_invoices_profile_status ON crm_invoices(crm_profile, status);
CREATE INDEX IF NOT EXISTS idx_crm_invoices_created ON crm_invoices(created_at DESC);
ALTER TABLE crm_invoices ADD COLUMN IF NOT EXISTS proposal_id INTEGER REFERENCES proposals(id) ON DELETE SET NULL;
