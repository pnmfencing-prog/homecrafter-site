import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { normalizeCrmProfile } from '@/lib/email-policy';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function isAdmin(request: NextRequest): boolean {
  const auth = request.headers.get('authorization') || '';
  const token = auth.replace('Bearer ', '');
  return token === (process.env.ADMIN_TOKEN || 'hc-admin-2026');
}

async function ensureInvoicesTable() {
  await sql`
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
      created_by TEXT,
      proposal_id INTEGER REFERENCES proposals(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_crm_invoices_lead ON crm_invoices(crm_lead_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_crm_invoices_profile_status ON crm_invoices(crm_profile, status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_crm_invoices_created ON crm_invoices(created_at DESC)`;
  await sql`ALTER TABLE crm_invoices ADD COLUMN IF NOT EXISTS proposal_id INTEGER REFERENCES proposals(id) ON DELETE SET NULL`;
}

function parseAmount(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

export async function GET(request: NextRequest) {
  if (!isAdmin(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureInvoicesTable();

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const leadIdRaw = searchParams.get('lead_id') || searchParams.get('crm_lead_id');
  const status = (searchParams.get('status') || 'all').toLowerCase();
  const profile = normalizeCrmProfile(searchParams.get('profile'));

  if (id) {
    const rows = await sql`
      SELECT i.*,
             l.customer_name AS lead_name,
             l.customer_phone AS lead_phone,
             l.customer_email AS lead_email,
             l.lead_code,
             l.twister_work_order
      FROM crm_invoices i
      LEFT JOIN crm_leads l ON l.id = i.crm_lead_id
      WHERE i.id = ${parseInt(id, 10)}
    `;
    if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ invoice: rows[0] });
  }

  if (leadIdRaw) {
    const leadId = parseInt(leadIdRaw, 10);
    if (!Number.isFinite(leadId)) return NextResponse.json({ error: 'Invalid lead_id' }, { status: 400 });
    const invoices = await sql`
      SELECT i.*,
             l.customer_name AS lead_name,
             l.customer_phone AS lead_phone,
             l.lead_code,
             l.twister_work_order
      FROM crm_invoices i
      LEFT JOIN crm_leads l ON l.id = i.crm_lead_id
      WHERE i.crm_lead_id = ${leadId}
      ORDER BY i.created_at DESC, i.id DESC
    `;
    return NextResponse.json({ invoices });
  }

  let invoices;
  if (status && status !== 'all') {
    invoices = await sql`
      SELECT i.*,
             l.customer_name AS lead_name,
             l.customer_phone AS lead_phone,
             l.customer_email AS lead_email,
             l.lead_code,
             l.twister_work_order,
             l.status AS lead_status
      FROM crm_invoices i
      LEFT JOIN crm_leads l ON l.id = i.crm_lead_id
      WHERE i.crm_profile = ${profile}
        AND i.status = ${status}
      ORDER BY
        CASE WHEN i.status = 'unpaid' THEN 0 WHEN i.status = 'paid' THEN 1 ELSE 2 END,
        i.created_at DESC,
        i.id DESC
    `;
  } else {
    invoices = await sql`
      SELECT i.*,
             l.customer_name AS lead_name,
             l.customer_phone AS lead_phone,
             l.customer_email AS lead_email,
             l.lead_code,
             l.twister_work_order,
             l.status AS lead_status
      FROM crm_invoices i
      LEFT JOIN crm_leads l ON l.id = i.crm_lead_id
      WHERE i.crm_profile = ${profile}
      ORDER BY
        CASE WHEN i.status = 'unpaid' THEN 0 WHEN i.status = 'paid' THEN 1 ELSE 2 END,
        i.created_at DESC,
        i.id DESC
    `;
  }

  const stats = await sql`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE status = 'unpaid')::int AS unpaid_count,
      count(*) FILTER (WHERE status = 'paid')::int AS paid_count,
      count(*) FILTER (WHERE status = 'void')::int AS void_count,
      coalesce(sum(amount) FILTER (WHERE status = 'unpaid'), 0)::numeric AS unpaid_value,
      coalesce(sum(amount) FILTER (WHERE status = 'paid'), 0)::numeric AS paid_value
    FROM crm_invoices
    WHERE crm_profile = ${profile}
  `;

  return NextResponse.json({ invoices, stats: stats[0] || null, profile });
}

export async function POST(request: NextRequest) {
  if (!isAdmin(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureInvoicesTable();

  const body = await request.json();
  const action = String(body.action || 'create');

  if (action === 'create') {
    const leadId = parseInt(String(body.crm_lead_id || body.lead_id || ''), 10);
    if (!Number.isFinite(leadId)) return NextResponse.json({ error: 'crm_lead_id required' }, { status: 400 });
    const description = String(body.description || '').trim();
    if (!description) return NextResponse.json({ error: 'description required' }, { status: 400 });

    const leadRows = await sql`SELECT id, crm_profile FROM crm_leads WHERE id = ${leadId}`;
    if (!leadRows.length) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    const profile = normalizeCrmProfile(body.crm_profile || leadRows[0].crm_profile);
    const amountPending = body.amount_pending === true || body.amount === null || body.amount === undefined || body.amount === '';
    const amount = amountPending ? null : parseAmount(body.amount);
    if (!amountPending && amount === null) {
      return NextResponse.json({ error: 'amount must be a number, or set amount_pending' }, { status: 400 });
    }
    const invoiceNo = body.invoice_no ? String(body.invoice_no).trim() : null;
    const createdBy = String(body.created_by || 'Dan').trim() || 'Dan';
    const pdfPath = body.pdf_path ? String(body.pdf_path).trim() : null;
    let proposalId: number | null = null;
    if (body.proposal_id !== undefined && body.proposal_id !== null && body.proposal_id !== '') {
      const parsedProposal = parseInt(String(body.proposal_id), 10);
      if (!Number.isFinite(parsedProposal)) {
        return NextResponse.json({ error: 'invalid proposal_id' }, { status: 400 });
      }
      proposalId = parsedProposal;
    }

    const rows = await sql`
      INSERT INTO crm_invoices (
        crm_lead_id, crm_profile, invoice_no, description, amount, amount_pending,
        status, pdf_path, created_by, proposal_id
      ) VALUES (
        ${leadId}, ${profile}, ${invoiceNo}, ${description}, ${amount}, ${amountPending},
        'unpaid', ${pdfPath}, ${createdBy}, ${proposalId}
      )
      RETURNING *
    `;
    await sql`
      INSERT INTO crm_activity (crm_lead_id, activity_type, description, created_by, is_from_customer)
      VALUES (
        ${leadId},
        'note',
        ${'Invoice created: ' + (invoiceNo ? '#' + invoiceNo + ' — ' : '') + description + (amountPending ? ' (amount pending)' : ' — $' + Number(amount).toFixed(2)) + ' [unpaid]'},
        ${createdBy},
        false
      )
    `;
    return NextResponse.json({ success: true, invoice: rows[0] });
  }

  if (action === 'mark_paid') {
    const id = parseInt(String(body.id || ''), 10);
    if (!Number.isFinite(id)) return NextResponse.json({ error: 'id required' }, { status: 400 });
    const paymentNote = body.payment_note != null ? String(body.payment_note).trim() : null;
    const paymentReference = body.payment_reference != null ? String(body.payment_reference).trim() : null;
    const markedBy = String(body.created_by || body.marked_by || 'Dan').trim() || 'Dan';
    const existing = await sql`SELECT * FROM crm_invoices WHERE id = ${id}`;
    if (!existing.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (existing[0].status === 'void') {
      return NextResponse.json({ error: 'Cannot mark a void invoice paid' }, { status: 400 });
    }
    const rows = await sql`
      UPDATE crm_invoices
      SET status = 'paid',
          paid_at = COALESCE(paid_at, NOW()),
          payment_note = COALESCE(${paymentNote}, payment_note),
          payment_reference = COALESCE(${paymentReference}, payment_reference),
          updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;
    const inv = rows[0];
    const amtLabel = inv.amount_pending || inv.amount == null ? 'amount pending' : ('$' + Number(inv.amount).toFixed(2));
    await sql`
      INSERT INTO crm_activity (crm_lead_id, activity_type, description, created_by, is_from_customer)
      VALUES (
        ${inv.crm_lead_id},
        'note',
        ${'Invoice marked paid: ' + (inv.invoice_no ? '#' + inv.invoice_no + ' — ' : '') + inv.description + ' — ' + amtLabel + (paymentReference ? ' (ref: ' + paymentReference + ')' : '')},
        ${markedBy},
        false
      )
    `;
    return NextResponse.json({ success: true, invoice: inv });
  }

  if (action === 'mark_unpaid') {
    const id = parseInt(String(body.id || ''), 10);
    if (!Number.isFinite(id)) return NextResponse.json({ error: 'id required' }, { status: 400 });
    const markedBy = String(body.created_by || body.marked_by || 'Dan').trim() || 'Dan';
    const existing = await sql`SELECT * FROM crm_invoices WHERE id = ${id}`;
    if (!existing.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (existing[0].status === 'void') {
      return NextResponse.json({ error: 'Cannot reopen a void invoice' }, { status: 400 });
    }
    const rows = await sql`
      UPDATE crm_invoices
      SET status = 'unpaid',
          paid_at = NULL,
          updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;
    await sql`
      INSERT INTO crm_activity (crm_lead_id, activity_type, description, created_by, is_from_customer)
      VALUES (
        ${rows[0].crm_lead_id},
        'note',
        ${'Invoice marked unpaid: ' + (rows[0].invoice_no ? '#' + rows[0].invoice_no + ' — ' : '') + rows[0].description},
        ${markedBy},
        false
      )
    `;
    return NextResponse.json({ success: true, invoice: rows[0] });
  }

  if (action === 'void') {
    const id = parseInt(String(body.id || ''), 10);
    if (!Number.isFinite(id)) return NextResponse.json({ error: 'id required' }, { status: 400 });
    const markedBy = String(body.created_by || body.marked_by || 'Dan').trim() || 'Dan';
    const note = body.payment_note != null ? String(body.payment_note).trim() : null;
    const existing = await sql`SELECT * FROM crm_invoices WHERE id = ${id}`;
    if (!existing.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const rows = await sql`
      UPDATE crm_invoices
      SET status = 'void',
          payment_note = COALESCE(${note}, payment_note),
          updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;
    await sql`
      INSERT INTO crm_activity (crm_lead_id, activity_type, description, created_by, is_from_customer)
      VALUES (
        ${rows[0].crm_lead_id},
        'note',
        ${'Invoice voided: ' + (rows[0].invoice_no ? '#' + rows[0].invoice_no + ' — ' : '') + rows[0].description},
        ${markedBy},
        false
      )
    `;
    return NextResponse.json({ success: true, invoice: rows[0] });
  }

  if (action === 'update') {
    const id = parseInt(String(body.id || ''), 10);
    if (!Number.isFinite(id)) return NextResponse.json({ error: 'id required' }, { status: 400 });
    const existing = await sql`SELECT * FROM crm_invoices WHERE id = ${id}`;
    if (!existing.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const description = body.description != null ? String(body.description).trim() : existing[0].description;
    if (!description) return NextResponse.json({ error: 'description required' }, { status: 400 });
    const invoiceNo = body.invoice_no !== undefined ? (body.invoice_no ? String(body.invoice_no).trim() : null) : existing[0].invoice_no;
    const pdfPath = body.pdf_path !== undefined
      ? (body.pdf_path ? String(body.pdf_path).trim() : null)
      : existing[0].pdf_path;
    let amountPending = existing[0].amount_pending;
    let amount = existing[0].amount;
    if (body.amount_pending === true) {
      amountPending = true;
      amount = null;
    } else if (body.amount !== undefined) {
      const parsed = parseAmount(body.amount);
      if (parsed === null && body.amount !== null && body.amount !== '') {
        return NextResponse.json({ error: 'invalid amount' }, { status: 400 });
      }
      amount = parsed;
      amountPending = parsed === null;
    }
    const rows = await sql`
      UPDATE crm_invoices
      SET description = ${description},
          invoice_no = ${invoiceNo},
          amount = ${amount},
          amount_pending = ${amountPending},
          pdf_path = ${pdfPath},
          updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;
    return NextResponse.json({ success: true, invoice: rows[0] });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
