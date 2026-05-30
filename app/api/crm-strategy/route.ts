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
  await sql`
    CREATE TABLE IF NOT EXISTS crm_strategy_todos (
      id SERIAL PRIMARY KEY,
      task TEXT NOT NULL,
      importance INTEGER NOT NULL DEFAULT 80 CHECK (importance BETWEEN 1 AND 100),
      completed BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  const existing = await sql`SELECT COUNT(*)::int AS count FROM crm_strategy_todos`;
  if (!existing[0]?.count) {
    await sql`
      INSERT INTO crm_strategy_todos (task, importance) VALUES
      ('Follow up fastest with every new lead before they shop around', 100),
      ('Build automated missed-lead rescue campaign for quiet prospects', 92),
      ('Collect and publish more finished-job photos/testimonials', 86),
      ('Reactivate old unsold estimates with a simple seasonal offer', 78),
      ('Improve Google Business Profile posts and review requests', 72)
    `;
  }
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

  const marketingChannels = [
    {
      channel: 'Batch leads / homeowner lists',
      priority: 'highest',
      strategy: 'Keep building targeted homeowner pools from deed activity, permits, high-value moves, and old-fence neighborhoods, then run compliant follow-up campaigns that route every response into the CRM.',
      nextAction: 'Create one repeatable monthly batch: source list, dedupe against CRM, enrich contact info, send first-touch campaign, track booked estimate rate.'
    },
    {
      channel: 'Local SEO',
      priority: 'high',
      strategy: 'Build durable organic demand around town + fence type searches: “vinyl fence installer Westfield”, “pool code aluminum fence Monmouth”, “cedar fence replacement NJ”.',
      nextAction: 'Publish/refresh service-area pages using real job photos, material explanations, permit notes, and FAQs pulled from CRM questions.'
    },
    {
      channel: 'Google Business Profile / LSA',
      priority: 'high',
      strategy: 'Turn completed jobs into reviews and photos. These channels already produce high-intent callers, so the goal is faster response and more proof.',
      nextAction: 'After every completed job, trigger a review/photo request and add best before/after images to GBP.'
    },
    {
      channel: 'Social proof content',
      priority: 'medium',
      strategy: 'Use Instagram/Facebook/TikTok less as “posting” and more as proof: before/after reels, gate installs, pool-code explainers, price-range education, crew/process clips.',
      nextAction: 'Save one photo/video set per job and turn it into 3 assets: before/after, material tip, customer-area post.'
    },
    {
      channel: 'Referral loops',
      priority: 'medium',
      strategy: 'Fence jobs are neighborhood-visible. Make each install create nearby demand from neighbors, HOAs, landscapers, realtors, pool companies, and property managers.',
      nextAction: 'Create a neighbor card/SMS/email follow-up for “we’re installing nearby” and a simple referral reward note.'
    },
    {
      channel: 'Past customer reactivation',
      priority: 'medium',
      strategy: 'Use the CRM to identify old quotes, lost-not-now leads, and seasonal delays. The cheapest lead is often someone already in the system.',
      nextAction: 'Run monthly campaigns for: spring repairs, pool season, storm damage, old quote check-ins, and September/October installs.'
    }
  ];

  const marketingExperiments = [
    {
      title: 'Neighborhood fence map campaign',
      why: 'Install photos plus a town/neighborhood angle makes outreach feel local instead of generic.',
      test: 'Pick 3 recent install neighborhoods and contact nearby homeowners with “we just finished a fence near you” messaging.'
    },
    {
      title: 'Fence buyer education funnel',
      why: 'Customers ask the same questions about material, gates, removal, permits, and pricing. Answering these publicly can create SEO and sales trust.',
      test: 'Publish 5 short pages/posts from CRM questions: vinyl vs wood, pool code aluminum, gate sizing, removal costs, and survey/permit basics.'
    },
    {
      title: 'Seasonal delay follow-up engine',
      why: 'Many leads are “not now,” not dead. Mid-season reminders can catch people when they are ready.',
      test: 'Tag delayed leads by target month and schedule a warm follow-up 30–45 days before their expected install window.'
    },
    {
      title: 'Estimate recovery campaign',
      why: 'People who say they never received an estimate or need a price are high-intent and easy to lose.',
      test: 'Create a saved view for “waiting on estimate / estimate not received” and contact within 1 business day.'
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
    marketingChannels,
    marketingExperiments,
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
  const todos = await sql`
    SELECT id, task, importance, completed, created_at, updated_at
    FROM crm_strategy_todos
    ORDER BY completed ASC, importance DESC, updated_at DESC
  `;
  return NextResponse.json({ ...data, saved, strategyTodos: todos });
}

export async function POST(request: NextRequest) {
  if (!isAdmin(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureTable();
  const body = await request.json().catch(() => ({}));

  if (body.action === 'save_todo') {
    const task = String(body.task || '').trim();
    const importance = Math.max(1, Math.min(100, Number(body.importance) || 80));
    if (!task) return NextResponse.json({ error: 'Task is required' }, { status: 400 });
    let todo;
    if (body.id) {
      const updated = await sql`
        UPDATE crm_strategy_todos
        SET task = ${task}, importance = ${importance}, completed = ${!!body.completed}, updated_at = NOW()
        WHERE id = ${Number(body.id)}
        RETURNING id, task, importance, completed, created_at, updated_at
      `;
      todo = updated[0];
    } else {
      const inserted = await sql`
        INSERT INTO crm_strategy_todos (task, importance, completed)
        VALUES (${task}, ${importance}, ${!!body.completed})
        RETURNING id, task, importance, completed, created_at, updated_at
      `;
      todo = inserted[0];
    }
    return NextResponse.json({ success: true, todo });
  }

  if (body.action === 'delete_todo') {
    await sql`DELETE FROM crm_strategy_todos WHERE id = ${Number(body.id)}`;
    return NextResponse.json({ success: true });
  }

  const data = await analyze();
  const title = String(body.title || 'CRM communication learning snapshot').slice(0, 200);
  const result = await sql`
    INSERT INTO crm_strategy_insights (title, insight_type, summary, payload)
    VALUES (${title}, ${body.insight_type || 'analysis'}, ${data.learningSummary}, ${JSON.stringify(data)}::jsonb)
    RETURNING id, title, created_at
  `;
  return NextResponse.json({ success: true, insight: result[0], analysis: data });
}
