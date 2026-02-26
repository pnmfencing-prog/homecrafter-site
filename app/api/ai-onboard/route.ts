import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { rateLimit } from '@/lib/rate-limit';
import { sanitizeCsvField } from '@/lib/sanitize';

const aiOnboardFile = path.join(process.cwd(), 'ai-onboard-submissions.csv');

function ensureCSV() {
  if (!fs.existsSync(aiOnboardFile)) {
    fs.writeFileSync(aiOnboardFile, 'timestamp,businessName,ownerName,phone,email,services,serviceArea,pricing,hours,website,challenge,plan\n');
  }
}

export async function POST(req: NextRequest) {
  try {
    // Rate limit: 3 per IP per 10 minutes
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    if (!rateLimit(`ai-onboard:${ip}`, 3, 10 * 60 * 1000)) {
      return NextResponse.json({ error: 'Too many submissions' }, { status: 429 });
    }

    const data = await req.json();
    ensureCSV();

    const csvLine = [
      new Date().toISOString(),
      sanitizeCsvField(data.businessName || ''),
      sanitizeCsvField(data.ownerName || ''),
      sanitizeCsvField(data.phone || ''),
      sanitizeCsvField(data.email || ''),
      sanitizeCsvField((data.services || []).join('; ')),
      sanitizeCsvField(data.serviceArea || ''),
      sanitizeCsvField(data.pricing || ''),
      sanitizeCsvField(data.hours || ''),
      sanitizeCsvField(data.website || ''),
      sanitizeCsvField((data.challenge || '').replace(/[\n\r,]/g, ' ')),
      sanitizeCsvField(data.plan || '')
    ].map((f: string) => `"${String(f).replace(/"/g, '""')}"`).join(',') + '\n';

    fs.appendFileSync(aiOnboardFile, csvLine);
    console.log(`AI onboard: ${sanitizeCsvField(data.businessName)} - ${sanitizeCsvField(data.plan)}`);

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('AI onboard error:', e);
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}
