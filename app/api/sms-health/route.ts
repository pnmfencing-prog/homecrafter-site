import { NextResponse } from 'next/server';

export async function GET() {
  const hasSid = Boolean(process.env.TWILIO_SID || process.env.TWILIO_ACCOUNT_SID);
  const hasToken = Boolean(process.env.TWILIO_TOKEN || process.env.TWILIO_AUTH_TOKEN);
  const hasFrom = Boolean(process.env.TWILIO_FROM || process.env.TWILIO_PHONE_NUMBER);

  return NextResponse.json({
    configured: hasSid && hasToken && hasFrom,
    twilio: { hasSid, hasToken, hasFrom },
  });
}
