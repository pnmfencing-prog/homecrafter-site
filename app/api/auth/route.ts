import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import sql from '@/lib/db';
import { rateLimit } from '@/lib/rate-limit';

const CRM_USERNAME = process.env.CRM_USERNAME || 'admin';
const CRM_PASSWORD = process.env.CRM_PASSWORD || 'HomeCrafter2026';
const SESSION_SECRET = process.env.SESSION_SECRET || 'pnm-fencing-session-secret-2026';
const CRM_ADMIN_EMAIL = process.env.CRM_ADMIN_EMAIL || 'pnmfencing@gmail.com';
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'https://homecrafter.ai').replace(/\/$/, '');
const BREVO_API_KEY = process.env.BREVO_API_KEY || '';
const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

async function ensureAuthTables() {
  await sql`
    CREATE TABLE IF NOT EXISTS crm_auth_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS crm_password_resets (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
}

async function getStoredPasswordHash(): Promise<string | null> {
  await ensureAuthTables();
  const rows = await sql`SELECT value FROM crm_auth_settings WHERE key = 'crm_password_hash' LIMIT 1`;
  return rows[0]?.value || null;
}

async function passwordMatches(password: string): Promise<boolean> {
  const storedHash = await getStoredPasswordHash();
  if (storedHash) return bcrypt.compare(password, storedHash);
  return password === CRM_PASSWORD;
}

async function setStoredPassword(password: string) {
  await ensureAuthTables();
  const hash = await bcrypt.hash(password, 12);
  await sql`
    INSERT INTO crm_auth_settings (key, value, updated_at)
    VALUES ('crm_password_hash', ${hash}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `;
}

function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function sendResetEmail(to: string, resetUrl: string) {
  if (!BREVO_API_KEY) {
    throw new Error('BREVO_API_KEY is not configured');
  }

  const html = `
    <div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#222;max-width:560px;margin:0 auto;padding:24px;">
      <h2 style="color:#1e1845;margin:0 0 12px;">PNM CRM password reset</h2>
      <p>Someone requested a password reset for the PNM Fencing management portal.</p>
      <p><a href="${resetUrl}" style="display:inline-block;background:#1e1845;color:#c4aa6a;text-decoration:none;padding:12px 18px;border-radius:6px;font-weight:bold;">Reset CRM password</a></p>
      <p>This link expires in 30 minutes. If you did not request it, you can ignore this email.</p>
      <p style="font-size:12px;color:#777;word-break:break-all;">${resetUrl}</p>
    </div>
  `;

  const res = await fetch(BREVO_ENDPOINT, {
    method: 'POST',
    headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sender: { name: 'PNM Fencing CRM', email: 'trent@homecrafter.ai' },
      to: [{ email: to }],
      subject: 'Reset your PNM CRM password',
      htmlContent: html,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Brevo error ${res.status}: ${err}`);
  }
}

function generateToken(username: string): string {
  const timestamp = Date.now().toString();
  const data = username + ':' + timestamp + ':' + SESSION_SECRET;
  const hash = createHash('sha256').update(data).digest('hex');
  // Token format: base64(username:timestamp:hash)
  const token = Buffer.from(username + ':' + timestamp + ':' + hash).toString('base64');
  return token;
}

export function verifyToken(token: string): boolean {
  try {
    const decoded = Buffer.from(token, 'base64').toString();
    const parts = decoded.split(':');
    if (parts.length !== 3) return false;
    const [username, timestamp, hash] = parts;
    
    // Check if token is older than 30 days
    const age = Date.now() - parseInt(timestamp);
    if (age > 30 * 24 * 60 * 60 * 1000) return false;
    
    // Verify hash
    const expectedData = username + ':' + timestamp + ':' + SESSION_SECRET;
    const expectedHash = createHash('sha256').update(expectedData).digest('hex');
    return hash === expectedHash;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { username, password, action, token } = body;
  const loginUsername = typeof username === 'string' ? username.trim() : username;
  const loginPassword = typeof password === 'string' ? password.trim() : password;
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  
  // Logout
  if (action === 'logout') {
    const response = NextResponse.json({ success: true });
    response.cookies.set('pnm_session', '', { 
      httpOnly: true, 
      secure: true, 
      sameSite: 'lax', 
      maxAge: 0,
      path: '/'
    });
    return response;
  }

  if (action === 'request_reset') {
    // Always return success so the endpoint cannot be used to enumerate accounts.
    if (!rateLimit(`crm-reset:${ip}`, 3, 15 * 60 * 1000)) {
      return NextResponse.json({ success: true });
    }

    if ((loginUsername || CRM_USERNAME).toLowerCase() === CRM_USERNAME.toLowerCase()) {
      await ensureAuthTables();
      const rawToken = randomBytes(32).toString('hex');
      const tokenHash = hashResetToken(rawToken);
      await sql`
        INSERT INTO crm_password_resets (username, token_hash, expires_at)
        VALUES (${CRM_USERNAME}, ${tokenHash}, NOW() + INTERVAL '30 minutes')
      `;
      await sendResetEmail(CRM_ADMIN_EMAIL, `${APP_URL}/login.html?reset=${rawToken}`);
    }

    return NextResponse.json({ success: true });
  }

  if (action === 'reset_password') {
    if (!rateLimit(`crm-reset-submit:${ip}`, 10, 15 * 60 * 1000)) {
      return NextResponse.json({ success: false, error: 'Too many attempts. Please try again later.' }, { status: 429 });
    }

    if (!token || typeof token !== 'string' || !loginPassword || typeof loginPassword !== 'string') {
      return NextResponse.json({ success: false, error: 'Reset token and new password are required' }, { status: 400 });
    }
    if (loginPassword.length < 10) {
      return NextResponse.json({ success: false, error: 'Password must be at least 10 characters' }, { status: 400 });
    }

    await ensureAuthTables();
    const tokenHash = hashResetToken(token);
    const rows = await sql`
      SELECT id FROM crm_password_resets
      WHERE username = ${CRM_USERNAME}
        AND token_hash = ${tokenHash}
        AND used_at IS NULL
        AND expires_at > NOW()
      LIMIT 1
    `;

    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Reset link is invalid or expired' }, { status: 400 });
    }

    await setStoredPassword(loginPassword);
    await sql`UPDATE crm_password_resets SET used_at = NOW() WHERE id = ${rows[0].id}`;
    const response = NextResponse.json({ success: true });
    response.cookies.set('pnm_session', '', { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 0, path: '/' });
    return response;
  }
  
  // Login
  if (!loginUsername || !loginPassword) {
    return NextResponse.json({ success: false, error: 'Username and password required' }, { status: 400 });
  }
  
  if (loginUsername.toLowerCase() !== CRM_USERNAME.toLowerCase() || !(await passwordMatches(loginPassword))) {
    return NextResponse.json({ success: false, error: 'Invalid username or password' }, { status: 401 });
  }
  
  const sessionToken = generateToken(CRM_USERNAME);
  
  const response = NextResponse.json({ success: true });
  response.cookies.set('pnm_session', sessionToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60, // 30 days
    path: '/'
  });
  
  return response;
}
