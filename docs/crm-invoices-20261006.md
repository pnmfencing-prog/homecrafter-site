# CRM durable invoices (2026-10-06)

## What existed
- Static HTML/PDF invoices under `/public/invoices` and `/root/clawd/invoices` (email attachments only).
- `invoice_link_opens` table + `/api/invoice-open` pixel for open tracking.
- No CRM ledger: nothing to mark paid/unpaid on a lead.

## What we built
Durable CRM invoices as DB records (source of truth for unpaid/paid). Twister Comp Paid is **not** required for this ledger (optional later mirror for Lowes WO jobs).

### Schema: `crm_invoices`
- `crm_lead_id` **required** (FK → crm_leads)
- `crm_profile` (pnm_fencing / fencecrafters / lowes_fencing)
- `proposal_id` **optional** (FK → proposals, nullable — Sudhir repair has none)
- `invoice_no`, `description`, `amount` (nullable), `amount_pending`
- `status`: `unpaid` | `paid` | `void`
- `paid_at`, `payment_note`, `payment_reference`, `pdf_path`, `created_by`, timestamps

### API
`/api/crm/invoices` (admin Bearer token)
- `GET ?profile=&status=all|unpaid|paid|void` — profile-wide list + stats
- `GET ?lead_id=` — invoices for one lead
- `GET ?id=` — one invoice
- `POST { action: "create", crm_lead_id, description, amount?, amount_pending?, invoice_no?, proposal_id? }`
- `POST { action: "mark_paid", id, payment_reference?, payment_note? }`
- `POST { action: "mark_unpaid", id }`
- `POST { action: "void", id }`
- `POST { action: "update", id, description?, amount?, amount_pending?, invoice_no? }`

Lead detail `GET /api/crm?id=` now also returns `invoices`.

### UI (not a board column)
1. **Lead profile → Invoices section** (create / list / mark paid / void)
2. **Profile-wide list**
   - FenceCrafters / PNM: `https://homecrafter.ai/crm.html?view=invoices&profile=fencecrafters` (or `pnm_fencing`)
   - Lowes: `https://homecrafter.ai/lowes-crm.html?view=invoices&profile=lowes_fencing`
   - `crm.html?view=invoices&profile=lowes_fencing` redirects to the Lowes URL and preserves `view`.

Filters on the invoices view: Open+paid / Unpaid / Paid / Void.

### How Dan marks one paid
1. Open the lead **or** Invoices view.
2. Click **Mark paid**.
3. Optional prompt for payment reference (Zelle, check #, etc.).
4. Status becomes `paid`, `paid_at` set; activity note logged on the lead.

### Sudhir Jangam (first real case)
- Lead **#12065** / Lowes / WO **41797798**
- Invoice **#SUDHIR-REPAIR-12065** (id 1)
- Amount **$2138.00** (from quoted 8ft double-gate repair/callback estimate)
- `proposal_id`: null
- Status: **unpaid**
- Lead URL: `https://homecrafter.ai/lowes-crm.html?lead=12065&profile=lowes_fencing`
- No customer SMS/email was sent.

### Out of scope this build
- Invoice-monitor bot
- Auto Twister Comp Paid sync
- Customer-facing send of invoice PDFs from this ledger
