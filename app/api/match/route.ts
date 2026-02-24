import { NextRequest, NextResponse } from 'next/server';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { matchContractors } = require('../../../lib/matcher');

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const zip = searchParams.get('zip');
  const services = searchParams.get('services')
    ? searchParams.get('services')!.split(',').map(s => s.trim())
    : [];
  const maxResults = parseInt(searchParams.get('max') || '3') || 3;

  if (!zip) {
    return NextResponse.json({ error: 'Missing ?zip= parameter' }, { status: 400 });
  }

  const result = matchContractors(zip, services, maxResults);
  return NextResponse.json(result);
}
