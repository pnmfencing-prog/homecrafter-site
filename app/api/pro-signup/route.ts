import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { rateLimit } from '@/lib/rate-limit';
import sql from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    // Rate limit: 3 signups per IP per hour
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    if (!rateLimit(`signup:${ip}`, 3, 60 * 60 * 1000)) {
      return NextResponse.json(
        { success: false, message: 'Too many signup attempts. Please try again later.' },
        { status: 429 }
      );
    }

    const { firstName, lastName, company, email, phone, service, zip, password } = await request.json();

    // Validate required fields
    if (!firstName || !lastName || !company || !email || !phone || !service || !zip || !password) {
      return NextResponse.json(
        { success: false, message: 'All fields are required' },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { success: false, message: 'Password must be at least 8 characters' },
        { status: 400 }
      );
    }

    // Check for existing email
    const existing = await sql`SELECT id FROM pro_accounts WHERE email = ${email.toLowerCase()}`;
    if (existing.length > 0) {
      return NextResponse.json(
        { success: false, message: 'An account with this email already exists' },
        { status: 409 }
      );
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Insert into database
    await sql`
      INSERT INTO pro_accounts (first_name, last_name, company, email, phone, password_hash, service, zip, status)
      VALUES (${firstName}, ${lastName}, ${company}, ${email.toLowerCase()}, ${phone}, ${passwordHash}, ${service}, ${zip}, 'pending')
    `;

    console.log(`New pro signup: ${firstName} ${lastName} - ${company} (${email})`);

    return NextResponse.json({ success: true, message: 'Account created successfully' });
  } catch (e) {
    console.error('Signup error:', e);
    return NextResponse.json(
      { success: false, message: 'Server error' },
      { status: 500 }
    );
  }
}
