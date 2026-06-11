import { NextRequest, NextResponse } from 'next/server';

const SESSION_SECRET = process.env.SESSION_SECRET || 'pnm-fencing-session-secret-2026';

// Pages that require login
const PROTECTED_PAGES = ['/calendar.html', '/crm.html', '/proposals.html'];

// Public API routes (no auth needed)
const PUBLIC_API = ['/api/auth', '/api/proposals/sign', '/api/proposals/pdf'];

async function sha256(message: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verifySessionToken(token: string): Promise<boolean> {
  try {
    const decoded = atob(token);
    const parts = decoded.split(':');
    if (parts.length !== 3) return false;
    const [username, timestamp, hash] = parts;
    
    // Check if token is older than 30 days
    const age = Date.now() - parseInt(timestamp);
    if (age > 30 * 24 * 60 * 60 * 1000) return false;
    
    // Verify hash
    const expectedData = username + ':' + timestamp + ':' + SESSION_SECRET;
    const expectedHash = await sha256(expectedData);
    return hash === expectedHash;
  } catch {
    return false;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  
  // Check if this is a public API route
  for (const route of PUBLIC_API) {
    if (pathname.startsWith(route)) {
      return NextResponse.next();
    }
  }
  
  // Check if this is a protected page
  const isProtectedPage = PROTECTED_PAGES.includes(pathname);
  const isProtectedApi = pathname.startsWith('/api/calendar') || 
                          pathname.startsWith('/api/crm') || 
                          pathname.startsWith('/api/proposals') ||
                          pathname.startsWith('/api/customers');
  
  if (!isProtectedPage && !isProtectedApi) {
    return NextResponse.next();
  }
  
  // Check for session cookie
  const sessionCookie = request.cookies.get('pnm_session')?.value;
  if (sessionCookie && await verifySessionToken(sessionCookie)) {
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
    '/api/customers/:path*',
  ]
};
