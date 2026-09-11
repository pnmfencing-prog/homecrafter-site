import { NextRequest } from 'next/server';

export function isCrmAdmin(request: NextRequest): boolean {
  const auth = request.headers.get('authorization') || '';
  const bearer = auth.replace(/^Bearer\s+/i, '').trim();
  const headerToken = (request.headers.get('x-admin-token') || '').trim();
  const expected = process.env.ADMIN_TOKEN || 'hc-admin-2026';
  return bearer === expected || headerToken === expected;
}

export function previewText(body: string, max = 240): string {
  const cleaned = String(body || '').replace(/\s+/g, ' ').trim();
  if (cleaned.length <= max) return cleaned;
  return cleaned.slice(0, max - 1) + '…';
}
