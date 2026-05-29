import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { normalizeText } from '@/lib/text';

function isAdmin(request: NextRequest): boolean {
  const auth = request.headers.get('authorization') || '';
  const token = auth.replace('Bearer ', '');
  return token === (process.env.ADMIN_TOKEN || 'hc-admin-2026');
}

function cleanMessage(value: string): string {
  return normalizeText(value || '')
    .replace(/^(📤|📥)\s*/, '')
    .replace(/^Scheduled SMS sent:\s*/i, '')
    .replace(/^Subject:\s*[^\n]+\n\n/i, '')
    .trim();
}

function avg(nums: number[]): number | null {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function minutesBetween(a: string | Date, b: string | Date): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / 60000;
}

function pct(n: number, d: number): number {
  return d ? Math.round((n / d) * 1000) / 10 : 0;
}

function keywordCount(messages: string[], patterns: RegExp[]): number {
  return messages.filter((m) => patterns.some((p) => p.test(m))).length;
}

function topPhrases(messages: string[]): { phrase: string; count: number }[] {
  const counts = new Map<string, number>();
  const stop = new Set(['the','and','for','you','are','with','that','this','have','what','can','not','but','all','was','from','our','your','will','just','need','looking','fence','fencing']);
  for (const msg of messages) {
    const words = msg.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !stop.has(w));
    for (let i = 0; i < words.length - 1; i++) {
      const phrase = `${words[i]} ${words[i + 1]}`;
      counts.set(phrase, (counts.get(phrase) || 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([phrase, count]) => ({ phrase, count }));
}

async function ensureTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS crm_strategy_insights (
      id SERIAL PRIMARY KEY,
      title VARCHAR(200) NOT NULL,
      insight_type VARCHAR(40) NOT NULL DEFAULT 'analysis',
      summary TEXT NOT NULL,
      payload JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
}

async function analyze() {
  const leads = await sql`
    SELECT id, source, status, service_type, quoted_amount, job_value, created_at, contacted_at, quoted_at, scheduled_at, completed_at, closed_at
    FROM crm_leads
    ORDER BY created_at DESC
  `;
  const activity = await sql`
    SELECT a.id, a.crm_lead_id, a.activity_type, a.description, a.is_from_customer, a.created_by, a.created_at,
           l.status, l.source, l.customer_name
    FROM crm_activity a
    LEFT JOIN crm_leads l ON l.id = a.crm_lead_id
    WHERE a.activity_type IN ('sms','email')
    ORDER BY a.crm_lead_id ASC, a.created_at ASC
  `;

  const messages = activity.map((a: any) => {
    const description = normalizeText(a.description || '');
    const outboundPrefix = description.startsWith('📤');
    const inboundPrefix = description.startsWith('📥');
    const fromCustomer = inboundPrefix ? true : outboundPrefix ? false : !!a.is_from_customer;
    return { ...a, text: cleanMessage(description), fromCustomer };
  }).filter((m: any) => m.text);

  const inbound = messages.filter((m: any) => m.fromCustomer);
  const outbound = messages.filter((m: any) => !m.fromCustomer);
  const customerTexts = inbound.map((m: any) => m.text.toLowerCase());
  const outboundTexts = outbound.map((m: any) => m.text.toLowerCase());

  const byLead = new Map<number, any[]>();
  for (const msg of messages) {
    const arr = byLead.get(msg.crm_lead_id) || [];
    arr.push(msg);
    byLead.set(msg.crm_lead_id, arr);
  }

  const responseMinutes: number[] = [];
  for (const arr of byLead.values()) {
    for (let i = 0; i < arr.length; i++) {
      if (!arr[i].fromCustomer) continue;
      const nextOutbound = arr.slice(i + 1).find((m) => !m.fromCustomer);
      if (nextOutbound) {
        const mins = minutesBetween(arr[i].created_at, nextOutbound.created_at);
        if (mins >= 0 && mins < 60 * 24 * 14) responseMinutes.push(mins);
      }
    }
  }

  const statusCounts = leads.reduce((acc: Record<string, number>, l: any) => {
    const key = l.status || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const totalLeads = leads.length;
  const won = statusCounts.won || 0;
  const quoted = (statusCounts.quoted || 0) + (statusCounts.scheduled || 0) + won;

  const customerQuestions = [
    { topic: 'Material choice', count: keywordCount(customerTexts, [/wood|vinyl|chain.?link|aluminum|cedar|spruce|material/]), lesson: 'Ask material early; it changes price, crew, and speed.' },
    { topic: 'Removal/demo', count: keywordCount(customerTexts, [/remov|take down|tear down|demo|old fence|existing/]), lesson: 'Clarify removal separately so quotes do not miss labor/disposal.' },
    { topic: 'Gates', count: keywordCount(customerTexts, [/gate|walk gate|double gate|driveway gate/]), lesson: 'Gate count and size should be asked before rough pricing.' },
    { topic: 'Price/budget', count: keywordCount(customerTexts, [/price|cost|quote|estimate|budget|how much/]), lesson: 'Customers often want a fast range before committing to a site visit.' },
    { topic: 'Timing/schedule', count: keywordCount(customerTexts, [/when|schedule|available|soon|install|timeline|start/]), lesson: 'Speed and availability can be used as a closing lever.' },
    { topic: 'Town/permit/HOA', count: keywordCount(customerTexts, [/permit|town|hoa|approval|variance|survey/]), lesson: 'Permit/town questions should trigger a checklist before install.' },
  ].sort((a, b) => b.count - a.count);

  const communicationLessons = [
    'Keep first replies short, direct, and question-based. The CRM shows customers respond best when the next step is easy.',
    'Ask qualifying questions in bundles: material, removal, gates, footage/location. This reduces back-and-forth and quote errors.',
    'Separate “pricing info received?” follow-ups from new qualifying questions. Mixing both can feel scattered.',
    'Use plain contractor language. Avoid polished sales copy unless the customer is already asking for formal details.',
    'When a customer sends photos or details, acknowledge specifically before asking the next question.'
  ];

  const strategyIdeas = [
    {
      mode: 'conservative',
      title: 'Standardize the first qualification message',
      impact: 'Fewer missed quote details; faster estimating.',
      idea: 'Use the material/removal/gates template when a customer asks vague pricing questions or says they are shopping.'
    },
    {
      mode: 'conservative',
      title: 'Create a “ready to quote” checklist',
      impact: 'Prevents quotes without gate/removal/material info.',
      idea: 'Before quote status, require material, approximate footage, removal yes/no, gate count, town, and photos/address.'
    },
    {
      mode: 'unique',
      title: 'Photo-first estimate flow',
      impact: 'Turns slow conversations into visual quoting workflows.',
      idea: 'When a lead stalls, send a friendly prompt asking for 3 photos: left side, right side, and where gates go.'
    },
    {
      mode: 'unique',
      title: 'Objection library from real chats',
      impact: 'Teaches future replies using Dan’s actual customer language.',
      idea: 'Tag common objections like price, timing, HOA, and material uncertainty, then save the best winning replies as templates.'
    },
    {
      mode: 'conservative',
      title: 'Response-speed scoreboard',
      impact: 'Improves close rate by reducing delayed replies.',
      idea: 'Track average response time and flag customer messages that have no staff response after 20 minutes during business hours.'
    }
  ];

  const avgResponse = avg(responseMinutes);
  const topOutbound = topPhrases(outboundTexts);
  const topCustomer = topPhrases(customerTexts);
  const learningSummary = [
    `Analyzed ${messages.length} CRM SMS/email/chat messages across ${byLead.size} lead threads.`,
    `Customer inbound messages: ${inbound.length}; staff outbound messages: ${outbound.length}.`,
    avgResponse !== null ? `Average staff response time after customer messages is about ${Math.round(avgResponse)} minutes.` : 'Not enough paired replies yet to calculate response time.',
    `Lead status mix: ${Object.entries(statusCounts).map(([k, v]) => `${k} ${v}`).join(', ')}.`,
    `Quote-or-better rate: ${pct(quoted, totalLeads)}%; won rate: ${pct(won, totalLeads)}%.`,
    `Most visible customer themes: ${customerQuestions.slice(0, 3).map((q) => `${q.topic} (${q.count})`).join(', ')}.`
  ].join('\n');

  return {
    generatedAt: new Date().toISOString(),
    metrics: {
      totalLeads,
      totalMessages: messages.length,
      inboundMessages: inbound.length,
      outboundMessages: outbound.length,
      avgResponseMinutes: avgResponse === null ? null : Math.round(avgResponse),
      quoteOrBetterRate: pct(quoted, totalLeads),
      wonRate: pct(won, totalLeads),
      statusCounts,
    },
    customerQuestions,
    communicationLessons,
    strategyIdeas,
    topCustomerPhrases: topCustomer,
    topOutboundPhrases: topOutbound,
    learningSummary,
  };
}

export async function GET(request: NextRequest) {
  if (!isAdmin(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureTable();
  const data = await analyze();
  const saved = await sql`
    SELECT id, title, insight_type, summary, created_at
    FROM crm_strategy_insights
    ORDER BY created_at DESC
    LIMIT 10
  `;
  return NextResponse.json({ ...data, saved });
}

export async function POST(request: NextRequest) {
  if (!isAdmin(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureTable();
  const body = await request.json().catch(() => ({}));
  const data = await analyze();
  const title = String(body.title || 'CRM communication learning snapshot').slice(0, 200);
  const result = await sql`
    INSERT INTO crm_strategy_insights (title, insight_type, summary, payload)
    VALUES (${title}, ${body.insight_type || 'analysis'}, ${data.learningSummary}, ${JSON.stringify(data)}::jsonb)
    RETURNING id, title, created_at
  `;
  return NextResponse.json({ success: true, insight: result[0], analysis: data });
}
