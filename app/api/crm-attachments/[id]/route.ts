import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';

function parseRange(rangeHeader: string | null, size: number): { start: number; end: number } | null {
  if (!rangeHeader || !rangeHeader.startsWith('bytes=')) return null;
  const [rawStart, rawEnd] = rangeHeader.replace('bytes=', '').split('-');
  let start = rawStart ? Number(rawStart) : NaN;
  let end = rawEnd ? Number(rawEnd) : size - 1;

  // Support suffix ranges like "bytes=-500".
  if (!rawStart && rawEnd) {
    const suffixLength = Number(rawEnd);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const disposition = request.nextUrl.searchParams.get('download') === '1' ? 'attachment' : 'inline';
  const rows = await sql`
    SELECT file_name, mime_type, content_base64
    FROM crm_attachments
    WHERE id = ${Number(id)}
    LIMIT 1
  `;
  if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const file = rows[0];
  const bytes = Buffer.from(file.content_base64 || '', 'base64');
  const safeName = String(file.file_name || 'attachment').replace(/["\r\n]/g, '');
  const contentType = file.mime_type || 'application/octet-stream';
  const baseHeaders = {
    'Content-Type': contentType,
    'Content-Disposition': `${disposition}; filename="${safeName}"`,
    'Cache-Control': 'private, max-age=31536000, immutable',
    'Accept-Ranges': 'bytes',
  };

  const range = parseRange(request.headers.get('range'), bytes.length);
  if (range) {
    const chunk = bytes.subarray(range.start, range.end + 1);
    return new NextResponse(chunk, {
      status: 206,
      headers: {
        ...baseHeaders,
        'Content-Range': `bytes ${range.start}-${range.end}/${bytes.length}`,
        'Content-Length': String(chunk.length),
      },
    });
  }

  return new NextResponse(bytes, {
    headers: {
      ...baseHeaders,
      'Content-Length': String(bytes.length),
    },
  });
}
