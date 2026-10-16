# Ops email attachments + invoice open/paid tracking (2026-10-16)

## Ops compose
- Email tab shows **📎 Attach invoice…** (vendor-linked invoices first, then open invoices in the vendor's CRM profile, with open count) and **⬆ Upload PDF/photo** (≤8MB, magic-byte checked, max 5 files / 15MB).
- `POST /api/ops/comm/messages` accepts `attachments: [{invoice_id}|{attachment_id}]` (email only). Files go out as real Brevo attachments; each invoice also gets a tracked "View invoice" link in the body. Links are stored in `crm_comm_message_attachments`; invoice `sent_at` / `vendor_id` set on send.
- `GET/POST /api/ops/comm/attachments` lists attachables / stores uploads (crm_attachments, vendor_id).

## Durable hosting
- Invoice PDFs are copied into `crm_attachments` on first use (`crm_invoices.pdf_attachment_id`), so they no longer depend on files committed under /public.
- Public tracked link: `/api/invoices/<INVOICE_NO>?r=<recipient>&src=…` logs to `invoice_link_opens` (with `crm_invoice_id`, `is_bot`) and bumps `open_count/first_opened_at/last_opened_at` for non-scanner opens, then serves the PDF.

## Plaid-ready fields (crm_invoices)
`payer_name, payer_email, vendor_id, issued_at, due_date, amount_paid, payment_source, external_txn_id (unique, nullable), external_account_id, match_confidence`. `scorePaymentMatch()` in `lib/ops-attachments-core.mjs` scores a txn vs. invoice (exact cents required; +invoice # in memo; +payer name).

## Deploy
1. Run `scripts/migrate-invoice-tracking-attachments.sql` (additive only) **before** merge.
2. Merge. Tests: `node --test tests/`.
