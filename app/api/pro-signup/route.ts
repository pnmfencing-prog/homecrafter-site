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

    const { firstName, lastName, company, email, phone, service, categories, zip, license, password } = await request.json();

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

    // Check if email exists in contractors database — auto-approve if so
    const cats: string[] = Array.isArray(categories) && categories.length > 0 ? categories : (service ? [service] : []);
    const emailLower = email.toLowerCase();
    const knownContractor = await sql`SELECT id FROM contractors WHERE LOWER(email) = ${emailLower} LIMIT 1`;
    const autoApprove = knownContractor.length > 0;
    const status = autoApprove ? 'active' : 'pending';

    await sql`
      INSERT INTO pro_accounts (first_name, last_name, company, email, phone, password_hash, service, zip, status, categories, license)
      VALUES (${firstName}, ${lastName}, ${company}, ${emailLower}, ${phone}, ${passwordHash}, ${service || cats[0] || ''}, ${zip}, ${status}, ${cats}, ${license || null})
    `;

    console.log(`New pro signup: ${firstName} ${lastName} - ${company} (${email})`);

    // Auto-link any guest lead purchases made with this email
    const emailLower = email.toLowerCase();
    const newAcct = await sql`SELECT id FROM pro_accounts WHERE email = ${emailLower} LIMIT 1`;
    if (newAcct.length > 0) {
      const acctId = newAcct[0].id;
      const linked = await sql`
        UPDATE lead_assignments SET pro_account_id = ${acctId}
        WHERE LOWER(stripe_email) = ${emailLower} AND pro_account_id IS NULL
        RETURNING id
      `;
      if (linked.length > 0) {
        console.log(`Auto-linked ${linked.length} guest lead(s) to new account ${acctId}`);
      }
    }

    return NextResponse.json({
      success: true,
      autoApproved: autoApprove,
      message: autoApprove
        ? 'Account created! You can log in now.'
        : 'Account created! Your account is being reviewed and will be approved shortly.'
    });
  } catch (e) {
    console.error('Signup error:', e);
    return NextResponse.json(
      { success: false, message: 'Server error' },
      { status: 500 }
    );
  }
}
