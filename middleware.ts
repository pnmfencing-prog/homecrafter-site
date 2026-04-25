import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';

const SESSION_SECRET = process.env.SESSION_SECRET || 'pnm-fencing-session-secret-2026';

// Pages that require login
const PROTECTED_PAGES = ['/calendar.html', '/crm.html', '/proposals.html'];

// API routes that require login (checked via cookie OR Bearer token)
const PROTECTED_API = ['/api/calendar', '/api/crm', '/api/proposals'];

// Public API routes (no auth needed)
const PUBLIC_API = ['/api/auth', '/api/proposals/sign', '/api/proposals/pdf'];

function verifySessionToken(token: string): boolean {
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

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  
  // Check if this is a public API route
  for (const route of PUBLIC_API) {
    if (pathname.startsWith(route)) {
      return NextResponse.next();
    }
  }
  
  // Check if this is a protected page
  const isProtectedPage = PROTECTED_PAGES.includes(pathname);
  const isProtectedApi = PROTECTED_API.some(route => pathname.startsWith(route));
  
  if (!isProtectedPage && !isProtectedApi) {
    return NextResponse.next();
  }
  
  // Check for session cookie
  const sessionCookie = request.cookies.get('pnm_session')?.value;
  if (sessionCookie && verifySessionToken(sessionCookie)) {
    return NextResponse.next();
  }
  
  // For API routes, also check Bearer token (for programmatic access)
  if (isProtectedApi) {
    const authHeader = request.headers.get('authorization');
    if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      if (token === (process.env.ADMIN_TOKEN || 'hc-admin-2026')) {
        return NextResponse.next();
      }
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  // For pages, redirect to login
  const loginUrl = new URL('/login.html', request.url);
  loginUrl.searchParams.set('redirect', pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    '/calendar.html',
    '/crm.html', 
    '/proposals.html',
    '/api/calendar/:path*',
    '/api/crm/:path*',
    '/api/proposals/:path*',
  ]
};
