import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const aiOnboardFile = path.join(process.cwd(), 'ai-onboard-submissions.csv');

function ensureCSV() {
  if (!fs.existsSync(aiOnboardFile)) {
    fs.writeFileSync(aiOnboardFile, 'timestamp,businessName,ownerName,phone,email,services,serviceArea,pricing,hours,website,challenge,plan\n');
  }
}

export async function POST(req: NextRequest) {
  try {
    const data = await req.json();
    ensureCSV();

    const csvLine = [
      new Date().toISOString(),
      data.businessName || '',
      data.ownerName || '',
      data.phone || '',
      data.email || '',
      (data.services || []).join('; '),
      data.serviceArea || '',
      data.pricing || '',
      data.hours || '',
      data.website || '',
      (data.challenge || '').replace(/[\n\r,]/g, ' '),
      data.plan || ''
    ].map((f: string) => `"${String(f).replace(/"/g, '""')}"`).join(',') + '\n';

    fs.appendFileSync(aiOnboardFile, csvLine);
    console.log(`AI onboard: ${data.businessName} - ${data.plan}`);

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('AI onboard error:', e);
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}
