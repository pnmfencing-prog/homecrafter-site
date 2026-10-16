-- Invoice open/paid tracking + Plaid-ready matching fields + Ops email attachments (2026-10-16)
ALTER TABLE crm_invoices ADD COLUMN IF NOT EXISTS vendor_id UUID REFERENCES crm_vendor_profiles(id) ON DELETE SET NULL;
ALTER TABLE crm_invoices ADD COLUMN IF NOT EXISTS payer_name TEXT;
ALTER TABLE crm_invoices ADD COLUMN IF NOT EXISTS payer_email TEXT;
ALTER TABLE crm_invoices ADD COLUMN IF NOT EXISTS issued_at DATE;
ALTER TABLE crm_invoices ADD COLUMN IF NOT EXISTS due_date DATE;
ALTER TABLE crm_invoices ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(12,2);
ALTER TABLE crm_invoices ADD COLUMN IF NOT EXISTS payment_source TEXT;            -- manual | plaid | stripe | check | zelle
ALTER TABLE crm_invoices ADD COLUMN IF NOT EXISTS external_txn_id TEXT;           -- e.g. Plaid transaction_id (nullable)
ALTER TABLE crm_invoices ADD COLUMN IF NOT EXISTS external_account_id TEXT;       -- e.g. Plaid account_id (nullable)
ALTER TABLE crm_invoices ADD COLUMN IF NOT EXISTS match_confidence NUMERIC(4,3);  -- auto-match score 0..1 (nullable)
ALTER TABLE crm_invoices ADD COLUMN IF NOT EXISTS pdf_attachment_id INTEGER;      -- durable copy in crm_attachments
ALTER TABLE crm_invoices ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
ALTER TABLE crm_invoices ADD COLUMN IF NOT EXISTS first_opened_at TIMESTAMPTZ;
ALTER TABLE crm_invoices ADD COLUMN IF NOT EXISTS last_opened_at TIMESTAMPTZ;
ALTER TABLE crm_invoices ADD COLUMN IF NOT EXISTS open_count INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_invoices_external_txn ON crm_invoices(external_txn_id) WHERE external_txn_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_invoices_invoice_no ON crm_invoices(lower(invoice_no));
CREATE INDEX IF NOT EXISTS idx_crm_invoices_match ON crm_invoices(status, amount);
CREATE INDEX IF NOT EXISTS idx_crm_invoices_vendor ON crm_invoices(vendor_id);

-- Open events (pixel + tracked PDF link) share invoice_link_opens; tie to invoice id when known.
CREATE TABLE IF NOT EXISTS invoice_link_opens (
  id SERIAL PRIMARY KEY, invoice_no TEXT NOT NULL, recipient TEXT, source TEXT, ip TEXT,
  user_agent TEXT, referer TEXT, alerted_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE invoice_link_opens ADD COLUMN IF NOT EXISTS crm_invoice_id INTEGER REFERENCES crm_invoices(id) ON DELETE SET NULL;
ALTER TABLE invoice_link_opens ADD COLUMN IF NOT EXISTS is_bot BOOLEAN NOT NULL DEFAULT FALSE;

-- Ops vendor uploads live in crm_attachments (lead-less), linked to vendor/message.
ALTER TABLE crm_attachments ALTER COLUMN crm_lead_id DROP NOT NULL;
ALTER TABLE crm_attachments ADD COLUMN IF NOT EXISTS vendor_id UUID;
ALTER TABLE crm_attachments ADD COLUMN IF NOT EXISTS comm_message_id UUID;
CREATE TABLE IF NOT EXISTS crm_comm_message_attachments (
  message_id UUID NOT NULL, attachment_id INTEGER NOT NULL, crm_invoice_id INTEGER,
  PRIMARY KEY (message_id, attachment_id)
);
