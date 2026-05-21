import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';

const DEFAULT_GOOGLE_ADS_WEBHOOK_KEY = 'HC-GADS-2026-7Q4N8K';

function str(value: any): string | null {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s || null;
}

function normalizePhone(value: any): string | null {
  const s = str(value);
  if (!s) return null;
  const digits = s.replace(/\D/g, '');
  if (digits.length === 10) return `+1 (${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  return s;
}

function expectedKey(): string {
  return process.env.GOOGLE_ADS_WEBHOOK_KEY || DEFAULT_GOOGLE_ADS_WEBHOOK_KEY;
}

function readColumnMap(body: any): Map<string, string> {
  const map = new Map<string, string>();
  const columns = Array.isArray(body?.user_column_data) ? body.user_column_data : [];
  for (const item of columns) {
    const value = str(item?.string_value);
    if (!value) continue;
    const id = str(item?.column_id)?.toUpperCase();
    const name = str(item?.column_name)?.toUpperCase();
    if (id) map.set(id, value);
    if (name) map.set(name, value);
  }
  return map;
}

function first(map: Map<string, string>, keys: string[]): string | null {
  for (const key of keys) {
    const value = map.get(key);
    if (value) return value;
  }
  return null;
}

function buildNotes(body: any, columns: Map<string, string>): string {
  const parts: string[] = ['Google Ads lead form submission'];
  if (body.is_test) parts.push('Test lead: true');
  if (body.lead_id) parts.push(`Google lead_id: ${body.lead_id}`);
  if (body.lead_submit_time) parts.push(`Submitted: ${body.lead_submit_time}`);
  if (body.lead_stage) parts.push(`Lead stage: ${body.lead_stage}`);
  if (body.lead_source) parts.push(`Lead source: ${body.lead_source}`);
  if (body.campaign_id) parts.push(`Campaign ID: ${body.campaign_id}`);
  if (body.adgroup_id) parts.push(`Ad group ID: ${body.adgroup_id}`);
  if (body.creative_id) parts.push(`Creative ID: ${body.creative_id}`);
  if (body.asset_group_id) parts.push(`Asset group ID: ${body.asset_group_id}`);
  if (body.form_id) parts.push(`Form ID: ${body.form_id}`);
  if (body.gcl_id) parts.push(`GCLID: ${body.gcl_id}`);

  const ignored = new Set([
    'FULL_NAME', 'FULL NAME', 'FIRST_NAME', 'FIRST NAME', 'LAST_NAME', 'LAST NAME',
    'EMAIL', 'USER EMAIL', 'WORK_EMAIL', 'WORK EMAIL', 'PHONE_NUMBER', 'USER PHONE',
    'WORK_PHONE', 'WORK PHONE', 'STREET_ADDRESS', 'STREET ADDRESS', 'CITY', 'REGION',
    'POSTAL_CODE', 'POSTAL CODE', 'COUNTRY', 'SERVICE', 'PRODUCT', 'CATEGORY'
  ]);
  const extra: string[] = [];
  for (const [key, value] of columns.entries()) {
    if (!ignored.has(key)) extra.push(`${key}: ${value}`);
  }
  if (extra.length) parts.push(`Form answers:\n${extra.map((x) => `- ${x}`).join('\n')}`);

  return parts.join('\n');
}

export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (str(body.google_key) !== expectedKey()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const columns = readColumnMap(body);
  const fullName = first(columns, ['FULL_NAME', 'FULL NAME']);
  const firstName = first(columns, ['FIRST_NAME', 'FIRST NAME']);
  const lastName = first(columns, ['LAST_NAME', 'LAST NAME']);
  const name = fullName || [firstName, lastName].filter(Boolean).join(' ') || (body.is_test ? 'Google Ads Test Lead' : null);
  const phone = normalizePhone(first(columns, ['PHONE_NUMBER', 'USER PHONE', 'WORK_PHONE', 'WORK PHONE']));
  const email = str(first(columns, ['EMAIL', 'USER EMAIL', 'WORK_EMAIL', 'WORK EMAIL']))?.toLowerCase() || null;
  const address = first(columns, ['STREET_ADDRESS', 'STREET ADDRESS']);
  const city = first(columns, ['CITY']);
  const state = first(columns, ['REGION']) || 'NJ';
  const zip = first(columns, ['POSTAL_CODE', 'POSTAL CODE']);
  const service = first(columns, ['SERVICE', 'PRODUCT', 'CATEGORY']) || 'Fencing';
  const notes = buildNotes(body, columns);
  const leadId = str(body.lead_id);

  if (!name && !phone && !email) {
    return NextResponse.json({ error: 'Missing customer identity' }, { status: 400 });
  }

  if (leadId) {
    const existingByLeadId = await sql`SELECT * FROM crm_leads WHERE source IN ('google_ads', 'google_ads_test') AND notes ILIKE ${`%Google lead_id: ${leadId}%`} LIMIT 1`;
    if (existingByLeadId.length) return NextResponse.json({});
  }

  if (phone) {
    const existing = await sql`SELECT * FROM crm_leads WHERE customer_phone = ${phone} LIMIT 1`;
    if (existing.length) {
      await sql`INSERT INTO crm_activity (crm_lead_id, activity_type, description, is_from_customer) VALUES (${existing[0].id}, 'note', ${`Duplicate Google Ads lead received${leadId ? ` (lead_id ${leadId})` : ''}.`}, true)`;
      return NextResponse.json({});
    }
  }

  if (email) {
    const existing = await sql`SELECT * FROM crm_leads WHERE LOWER(customer_email) = ${email} LIMIT 1`;
    if (existing.length) {
      await sql`INSERT INTO crm_activity (crm_lead_id, activity_type, description, is_from_customer) VALUES (${existing[0].id}, 'note', ${`Duplicate Google Ads lead received${leadId ? ` (lead_id ${leadId})` : ''}.`}, true)`;
      return NextResponse.json({});
    }
  }

  const chatToken = [...Array(16)].map(() => Math.random().toString(36)[2]).join('');
  const maxCode = await sql`SELECT COALESCE(MAX(CAST(lead_code AS INTEGER)), 99) + 1 as next_code FROM crm_leads WHERE lead_code ~ '^[0-9]+$'`;
  const leadCode = String(maxCode[0].next_code);
  const source = body.is_test ? 'google_ads_test' : 'google_ads';

  const result = await sql`
    INSERT INTO crm_leads (customer_name, customer_phone, customer_email, customer_address, customer_city, customer_state, customer_zip, service_type, notes, source, status, chat_token, lead_code, is_read)
    VALUES (${name}, ${phone}, ${email}, ${address}, ${city}, ${state}, ${zip}, ${service}, ${notes}, ${source}, 'new', ${chatToken}, ${leadCode}, false)
    RETURNING *
  `;

  await sql`INSERT INTO crm_activity (crm_lead_id, activity_type, description, is_from_customer) VALUES (${result[0].id}, 'status_change', 'Google Ads lead received via webhook', false)`;

  // Google expects a 200 with an empty JSON object on success.
  return NextResponse.json({});
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: 'google-ads-leads' });
}
