import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const PIXEL = Buffer.from(
  'R0lGODlhAQABAPAAAP///wAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==',
  'base64'
);

function clientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    request.headers.get('cf-connecting-ip') ||
    ''
  );
}

export async function GET(request: NextRequest) {
  const invoice = request.nextUrl.searchParams.get('invoice') || 'unknown';
  const recipient = request.nextUrl.searchParams.get('recipient') || 'unknown';
  const source = request.nextUrl.searchParams.get('src') || 'invoice_page';
  const userAgent = request.headers.get('user-agent') || '';
  const referer = request.headers.get('referer') || '';
  const ip = clientIp(request);

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS invoice_link_opens (
        id SERIAL PRIMARY KEY,
        invoice_no TEXT NOT NULL,
        recipient TEXT,
        source TEXT,
        ip TEXT,
        user_agent TEXT,
        referer TEXT,
        alerted_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`
      INSERT INTO invoice_link_opens (invoice_no, recipient, source, ip, user_agent, referer)
      VALUES (${invoice}, ${recipient}, ${source}, ${ip}, ${userAgent}, ${referer})
    `;
  } catch (error) {
    console.error('invoice-open tracking failed', error);
  }

  return new NextResponse(PIXEL, {
    headers: {
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
      Pragma: 'no-cache',
      Expires: '0',
    },
  });
}
