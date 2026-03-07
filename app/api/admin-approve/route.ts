import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';

// GET — list pending accounts
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') || 'pending';

  const accounts = await sql`
    SELECT id, first_name, last_name, company, email, phone, service, categories, zip, status, created_at
    FROM pro_accounts
    WHERE status = ${status}
    ORDER BY created_at DESC
  `;

  return NextResponse.json({ accounts });
}

// POST — approve or reject
export async function POST(req: NextRequest) {
  const { id, action } = await req.json();

  if (!id || !['approve', 'reject'].includes(action)) {
    return NextResponse.json({ error: 'id and action (approve|reject) required' }, { status: 400 });
  }

  if (action === 'approve') {
    // Activate the account
    await sql`UPDATE pro_accounts SET status = 'active' WHERE id = ${id}`;

    // Add to contractors table if not already there
    const account = await sql`
      SELECT first_name, last_name, company, email, phone, categories, zip
      FROM pro_accounts WHERE id = ${id}
    `;

    if (account.length > 0) {
      const a = account[0];
      const existsInContractors = await sql`
        SELECT id FROM contractors WHERE LOWER(email) = LOWER(${a.email}) LIMIT 1
      `;

      if (existsInContractors.length === 0) {
        // Add to contractors for each category they selected
        const cats: string[] = a.categories?.length > 0 ? a.categories : ['General'];
        const name = a.company || `${a.first_name} ${a.last_name}`.trim();

        for (const cat of cats) {
          await sql`
            INSERT INTO contractors (name, email, phone, zip, category, state, rating, reviews)
            VALUES (${name}, ${a.email}, ${a.phone}, ${a.zip}, ${cat}, 'NJ', 5.0, 0)
          `;
        }
        console.log(`Added ${name} to contractors table (${cats.length} categories)`);
      }
    }

    return NextResponse.json({ success: true, status: 'active' });
  } else {
    await sql`UPDATE pro_accounts SET status = 'rejected' WHERE id = ${id}`;
    return NextResponse.json({ success: true, status: 'rejected' });
  }
}
