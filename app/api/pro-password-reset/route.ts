import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import sql from '@/lib/db';
import { rateLimit } from '@/lib/rate-limit';

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'https://homecrafter.ai').replace(/\/$/, '');
const BREVO_API_KEY = process.env.BREVO_API_KEY || '';
const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

async function ensureResetTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS pro_password_resets (
      id SERIAL PRIMARY KEY,
      pro_account_id INTEGER NOT NULL REFERENCES pro_accounts(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function sendResetEmail(to: string, name: string, resetUrl: string) {
  if (!BREVO_API_KEY) throw new Error('BREVO_API_KEY is not configured');

  const html = `
    <div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#222;max-width:560px;margin:0 auto;padding:24px;">
      <h2 style="color:#1e1845;margin:0 0 12px;">Reset your HomeCrafter password</h2>
      <p>Hi ${name || 'there'},</p>
      <p>We received a request to reset the password for your HomeCrafter Pro account.</p>
      <p><a href="${resetUrl}" style="display:inline-block;background:#1e1845;color:#d4c394;text-decoration:none;padding:12px 18px;border-radius:6px;font-weight:bold;">Reset password</a></p>
      <p>This link expires in 30 minutes. If you did not request it, you can ignore this email.</p>
      <p style="font-size:12px;color:#777;word-break:break-all;">${resetUrl}</p>
    </div>
  `;

  const res = await fetch(BREVO_ENDPOINT, {
    method: 'POST',
    headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sender: { name: 'HomeCrafter', email: 'trent@homecrafter.ai' },
      to: [{ email: to, name }],
      subject: 'Reset your HomeCrafter password',
      htmlContent: html,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Brevo error ${res.status}: ${err}`);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = body.action || 'request_reset';
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';

    if (action === 'request_reset') {
      if (!rateLimit(`pro-reset:${ip}`, 5, 15 * 60 * 1000)) {
        return NextResponse.json({ success: true });
      }

      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (!email) return NextResponse.json({ success: true });

      const users = await sql`
        SELECT id, first_name, last_name, email
        FROM pro_accounts
        WHERE email = ${email}
        LIMIT 1
      `;

      // Always return success so the endpoint cannot be used to enumerate accounts.
      if (users.length === 0) return NextResponse.json({ success: true });

      await ensureResetTable();
      const user = users[0];
      const rawToken = randomBytes(32).toString('hex');
      const tokenHash = hashToken(rawToken);
      await sql`
        INSERT INTO pro_password_resets (pro_account_id, token_hash, expires_at)
        VALUES (${user.id}, ${tokenHash}, NOW() + INTERVAL '30 minutes')
      `;

      const name = `${user.first_name || ''} ${user.last_name || ''}`.trim();
      const resetUrl = `${APP_URL}/pro-login.html?reset=${rawToken}&email=${encodeURIComponent(user.email)}`;
      await sendResetEmail(user.email, name, resetUrl);

      return NextResponse.json({ success: true });
    }

    if (action === 'reset_password') {
      if (!rateLimit(`pro-reset-submit:${ip}`, 10, 15 * 60 * 1000)) {
        return NextResponse.json({ success: false, message: 'Too many attempts. Please try again later.' }, { status: 429 });
      }

      const token = typeof body.token === 'string' ? body.token : '';
      const password = typeof body.password === 'string' ? body.password.trim() : '';
      if (!token || !password) {
        return NextResponse.json({ success: false, message: 'Reset token and new password are required' }, { status: 400 });
      }
      if (password.length < 10) {
        return NextResponse.json({ success: false, message: 'Password must be at least 10 characters' }, { status: 400 });
      }

      await ensureResetTable();
      const tokenHash = hashToken(token);
      const rows = await sql`
        SELECT id, pro_account_id
        FROM pro_password_resets
        WHERE token_hash = ${tokenHash}
          AND used_at IS NULL
          AND expires_at > NOW()
        LIMIT 1
      `;

      if (rows.length === 0) {
        return NextResponse.json({ success: false, message: 'Reset link is invalid or expired' }, { status: 400 });
      }

      const hash = await bcrypt.hash(password, 12);
      await sql`UPDATE pro_accounts SET password_hash = ${hash}, status = 'active' WHERE id = ${rows[0].pro_account_id}`;
      await sql`UPDATE pro_password_resets SET used_at = NOW() WHERE id = ${rows[0].id}`;

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, message: 'Unknown action' }, { status: 400 });
  } catch (e) {
    console.error('Pro password reset error:', e);
    return NextResponse.json({ success: false, message: 'Server error' }, { status: 500 });
  }
}
