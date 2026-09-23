-- Additive: CRM install start + Twister push status (Ready to schedule / Lowes bridge)
-- Safe: no drops, no mass status migration.

ALTER TABLE crm_leads
  ADD COLUMN IF NOT EXISTS install_start timestamptz;

ALTER TABLE crm_leads
  ADD COLUMN IF NOT EXISTS install_start_twister_status text;

ALTER TABLE crm_leads
  ADD COLUMN IF NOT EXISTS install_start_twister_error text;

ALTER TABLE crm_leads
  ADD COLUMN IF NOT EXISTS install_start_twister_pushed_at timestamptz;

COMMENT ON COLUMN crm_leads.install_start IS 'CRM install start (ET-oriented); Lowes+WO save queues Twister Schedule Install Date';
COMMENT ON COLUMN crm_leads.install_start_twister_status IS 'pending|pushed|failed|skipped|null';
