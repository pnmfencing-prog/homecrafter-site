import { NextRequest } from 'next/server';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'hc-pro-secret-change-in-production';

export interface ProUser {
  id: number;
  email: string;
  name: string;
}

export function verifyProToken(request: NextRequest): ProUser | null {
  try {
    // Check cookie first, then Authorization header
    let token = request.cookies.get('pro_token')?.value;
    if (!token) {
      const authHeader = request.headers.get('authorization');
      if (authHeader?.startsWith('Bearer ')) {
        token = authHeader.slice(7);
      }
    }
    if (!token) return null;

    const decoded = jwt.verify(token, JWT_SECRET) as ProUser;
    if (!decoded.id || !decoded.email) return null;
    return decoded;
  } catch {
    return null;
  }
}
