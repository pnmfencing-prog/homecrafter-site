import { NextResponse } from 'next/server';

export async function POST() {
  const now = new Date();
  const est = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const hour = est.getHours();
  const day = est.getDay();

  const isBusinessHours =
    (day >= 1 && day <= 5 && hour >= 8 && hour < 18) ||
    (day === 6 && hour >= 9 && hour < 14);

  let twiml = '<?xml version="1.0" encoding="UTF-8"?><Response>';

  if (!isBusinessHours) {
    twiml += "<Message>Thanks for reaching out to HomeCrafter! Our office hours are Mon-Fri 8AM-6PM and Sat 9AM-2PM. We'll get back to you on the next business day. For urgent matters, call (732) 337-6181.</Message>";
  }

  twiml += '</Response>';

  return new NextResponse(twiml, {
    headers: { 'Content-Type': 'text/xml' },
  });
}
