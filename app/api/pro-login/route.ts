import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'hc-pro-secret-change-in-production';

// Accounts — swap with DB lookup later
const USERS: Record<string, { passwordHash: string; name: string }> = {
  'demo@homecrafter.ai': {
    passwordHash: '$2b$12$AUSyUxpfPhHgz39TQQKqne99lDjKoaJVab/YrYiYfQaC9Fh8mwzxm',
    name: 'Demo Contractor',
  },
  'dan.pnmfencing@gmail.com': {
    passwordHash: '$2b$12$qzE.CmmFDVxd9vcP4PXcuuUXriit4sNZDcg1hFxfNqDrlWMWp9SRC',
    name: 'Dan Mahler',
  },
};

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { success: false, message: 'Email and password required' },
        { status: 400 }
      );
    }

    const user = USERS[email.toLowerCase()];
    if (!user) {
      // Constant-time: still run bcrypt compare to prevent timing attacks
      await bcrypt.compare(password, '$2b$12$invalidhashplaceholderxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
      return NextResponse.json(
        { success: false, message: 'Invalid credentials' },
        { status: 401 }
      );
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return NextResponse.json(
        { success: false, message: 'Invalid credentials' },
        { status: 401 }
      );
    }

    // Issue JWT token (expires in 7 days)
    const token = jwt.sign(
      { email: email.toLowerCase(), name: user.name },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return NextResponse.json({ success: true, token, name: user.name });
  } catch {
    return NextResponse.json(
      { success: false, message: 'Server error' },
      { status: 500 }
    );
  }
}
