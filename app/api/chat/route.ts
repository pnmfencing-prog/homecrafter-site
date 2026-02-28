import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const SYSTEM_PROMPT = `You are the HomeCrafter assistant, a helpful home improvement advisor on homecrafter.ai. You help homeowners understand their projects, estimate rough costs, explain what to expect, and guide them toward getting matched with top-rated local contractors. Keep responses concise (2-3 sentences max). Be warm and helpful. When appropriate, suggest they fill out the free matching form at homecrafter.ai/services.html to get connected with up to 3 vetted local pros. Never mention competitor platforms. HomeCrafter services: fencing, roofing, windows, siding, painting, locksmith, housekeeping, flooring, carpet, HVAC, landscaping, irrigation, concrete, kitchen remodeling, bathroom remodeling, pest control, handyman, security systems.`;

const rateLimitMap = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const timestamps = rateLimitMap.get(ip) || [];
  const recent = timestamps.filter(t => now - t < 60000);
  if (recent.length >= 10) return true;
  recent.push(now);
  rateLimitMap.set(ip, recent);
  return false;
}

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    if (isRateLimited(ip)) {
      return NextResponse.json({ reply: "You're sending messages too quickly. Please wait a moment." }, { status: 429 });
    }

    const { message, history } = await req.json();
    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'Message required' }, { status: 400 });
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    if (Array.isArray(history)) {
      const recent = history.slice(-10);
      for (const msg of recent) {
        if (msg.role === 'user' || msg.role === 'assistant') {
          messages.push({ role: msg.role, content: msg.content });
        }
      }
    }
    messages.push({ role: 'user', content: message });

    const response = await client.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages,
    });

    const reply = response.content[0].type === 'text' ? response.content[0].text : '';
    return NextResponse.json({ reply });
  } catch (e) {
    console.error('Chat API error:', e);
    return NextResponse.json({ reply: "Sorry, I'm having trouble right now. Please try again in a moment." }, { status: 500 });
  }
}
