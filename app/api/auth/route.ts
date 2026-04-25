import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomBytes } from 'crypto';

const CRM_USERNAME = process.env.CRM_USERNAME || 'admin';
const CRM_PASSWORD = process.env.CRM_PASSWORD || 'pnm2026!';
const SESSION_SECRET = process.env.SESSION_SECRET || 'pnm-fencing-session-secret-2026';

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
  const { username, password, action } = body;
  
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
  
  // Login
  if (!username || !password) {
    return NextResponse.json({ success: false, error: 'Username and password required' }, { status: 400 });
  }
  
  if (username !== CRM_USERNAME || password !== CRM_PASSWORD) {
    return NextResponse.json({ success: false, error: 'Invalid username or password' }, { status: 401 });
  }
  
  const token = generateToken(username);
  
  const response = NextResponse.json({ success: true });
  response.cookies.set('pnm_session', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60, // 30 days
    path: '/'
  });
  
  return response;
}
