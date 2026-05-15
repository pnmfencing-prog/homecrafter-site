import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const rows = await sql`
    SELECT file_name, mime_type, content_base64
    FROM crm_attachments
    WHERE id = ${Number(id)}
    LIMIT 1
  `;
  if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const file = rows[0];
  const bytes = Buffer.from(file.content_base64 || '', 'base64');
  return new NextResponse(bytes, {
    headers: {
      'Content-Type': file.mime_type || 'application/octet-stream',
      'Content-Disposition': `inline; filename="${String(file.file_name || 'attachment').replace(/"/g, '')}"`,
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  });
}
