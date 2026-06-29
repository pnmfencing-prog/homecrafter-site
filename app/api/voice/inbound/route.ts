import { NextResponse } from 'next/server';

function twiml(body: string) {
  return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  });
}

export async function GET() {
  return POST();
}

export async function POST() {
  const message = 'Thanks for calling FenceCrafters. This number is text only, so calls are not monitored here. Please send us a text message at this number, or call our office at 908-503-5473. Thank you.';
  return twiml(`<Say voice="alice">${message}</Say><Hangup/>`);
}
