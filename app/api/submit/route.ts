import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const submissionsFile = path.join(process.cwd(), 'form-submissions.csv');

function ensureCSV() {
  if (!fs.existsSync(submissionsFile)) {
    fs.writeFileSync(submissionsFile, 'timestamp,name,email,phone,address,services,notes\n');
  }
}

export async function POST(req: NextRequest) {
  try {
    const data = await req.json();
    ensureCSV();

    const csvLine = [
      data.submitted || new Date().toISOString(),
      data.name || '',
      data.email || '',
      data.phone || '',
      data.address || '',
      (data.services || []).join('; '),
      (data.notes || '').replace(/[\n\r,]/g, ' ')
    ].map((f: string) => `"${f.replace(/"/g, '""')}"`).join(',') + '\n';

    fs.appendFileSync(submissionsFile, csvLine);
    console.log(`New submission: ${data.name} - ${(data.services || []).join(', ')}`);

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Submit error:', e);
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}
