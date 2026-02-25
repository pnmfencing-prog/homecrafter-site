import { NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'hc-pro-secret-change-in-production';

export async function POST(request: Request) {
  try {
    const { token } = await request.json();
    if (!token) {
      return NextResponse.json({ valid: false }, { status: 401 });
    }

    const decoded = jwt.verify(token, JWT_SECRET) as { email: string; name: string };
    return NextResponse.json({ valid: true, name: decoded.name, email: decoded.email });
  } catch {
    return NextResponse.json({ valid: false }, { status: 401 });
  }
}
