import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const { email, password } = await request.json();

  // Demo credentials — replace with real DB auth later
  if (email === 'demo@homecrafter.ai' && password === 'HomeCrafter2026') {
    return NextResponse.json({
      success: true,
      token: 'demo-token',
      name: 'Demo Contractor',
    });
  }

  return NextResponse.json(
    { success: false, message: 'Invalid credentials' },
    { status: 401 }
  );
}
