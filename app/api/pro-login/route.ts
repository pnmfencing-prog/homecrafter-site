import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { rateLimit } from '@/lib/rate-limit';
import sql from '@/lib/db';

const JWT_SECRET = process.env.JWT_SECRET || 'hc-pro-secret-change-in-production';

export async function POST(request: NextRequest) {
  try {
    // Rate limit: 5 login attempts per IP per 15 minutes
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    if (!rateLimit(`login:${ip}`, 5, 15 * 60 * 1000)) {
      return NextResponse.json(
        { success: false, message: 'Too many login attempts. Please try again in 15 minutes.' },
        { status: 429 }
      );
    }

    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { success: false, message: 'Email and password required' },
        { status: 400 }
      );
    }

    // Look up user in database
    const users = await sql`
      SELECT id, first_name, last_name, email, password_hash, status 
      FROM pro_accounts 
      WHERE email = ${email.toLowerCase()}
    `;

    if (users.length === 0) {
      // Constant-time: still run bcrypt compare to prevent timing attacks
      await bcrypt.compare(password, '$2b$12$invalidhashplaceholderxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
      return NextResponse.json(
        { success: false, message: 'Invalid credentials' },
        { status: 401 }
      );
    }

    const user = users[0];

    // Check if account is active
    if (user.status !== 'active') {
      return NextResponse.json(
        { success: false, message: 'Account pending approval. We\'ll notify you when it\'s ready.' },
        { status: 403 }
      );
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return NextResponse.json(
        { success: false, message: 'Invalid credentials' },
        { status: 401 }
      );
    }

    const name = `${user.first_name} ${user.last_name}`;

    // Issue JWT token (expires in 7 days)
    const token = jwt.sign(
      { id: user.id, email: user.email, name },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return NextResponse.json({ success: true, token, name });
  } catch (e) {
    console.error('Login error:', e);
    return NextResponse.json(
      { success: false, message: 'Server error' },
      { status: 500 }
    );
  }
}
