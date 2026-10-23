-- Backstop: non-void CRM invoices with no linked PDF attachment (report only; never auto-links).
-- candidate_pdfs = outbound PDF attachments on the same lead, not linked to any invoice, whose file name
-- contains the invoice number. Link by hand only when exactly one candidate clearly matches.
SELECT i.id, i.invoice_no, i.crm_lead_id, l.customer_name, l.twister_work_order, i.amount, i.status,
       i.pdf_path, i.created_at,
       (SELECT string_agg(a.id || ':' || a.file_name, '; ' ORDER BY a.id)
          FROM crm_attachments a
         WHERE a.crm_lead_id = i.crm_lead_id AND a.mime_type = 'application/pdf'
           AND NOT EXISTS (SELECT 1 FROM crm_invoices x WHERE x.pdf_attachment_id = a.id)
           AND i.invoice_no IS NOT NULL AND a.file_name ILIKE '%' || i.invoice_no || '%') AS candidate_pdfs
FROM crm_invoices i
LEFT JOIN crm_leads l ON l.id = i.crm_lead_id
WHERE i.pdf_attachment_id IS NULL AND i.status <> 'void'
ORDER BY i.id;
