import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';

function isAdmin(request: NextRequest): boolean {
  const auth = request.headers.get('authorization') || '';
  const token = auth.replace('Bearer ', '');
  return token === (process.env.ADMIN_TOKEN || 'hc-admin-2026');
}

function clean(value: unknown, max = 500): string | null {
  const text = String(value || '').trim().slice(0, max);
  return text || null;
}

async function ensureSchema() {
  await sql`
    CREATE TABLE IF NOT EXISTS fb04_students (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      graduating_year INTEGER,
      sex TEXT,
      single_status TEXT,
      university TEXT,
      photo_base64 TEXT,
      photo_mime TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS fb04_wall_posts (
      id SERIAL PRIMARY KEY,
      student_id INTEGER REFERENCES fb04_students(id) ON DELETE SET NULL,
      author_name TEXT NOT NULL DEFAULT 'Dan',
      body TEXT,
      image_base64 TEXT,
      image_mime TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS fb04_likes (
      id SERIAL PRIMARY KEY,
      post_id INTEGER NOT NULL REFERENCES fb04_wall_posts(id) ON DELETE CASCADE,
      liker_name TEXT NOT NULL DEFAULT 'Dan',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(post_id, liker_name)
    )
  `;
  await sql`
    INSERT INTO fb04_students (name, graduating_year, sex, single_status, university)
    SELECT * FROM (VALUES
      ('Mark Zuckerberg', 2006, 'Male', 'Single', 'Harvard'),
      ('Erica Albright', 2005, 'Female', 'It''s complicated', 'Boston University'),
      ('Eduardo Saverin', 2006, 'Male', 'Single', 'Harvard'),
      ('Christy Lee', 2007, 'Female', 'Single', 'Harvard')
    ) AS seed(name, graduating_year, sex, single_status, university)
    WHERE NOT EXISTS (SELECT 1 FROM fb04_students)
  `;
  await sql`
    INSERT INTO fb04_wall_posts (student_id, author_name, body)
    SELECT id, 'Thefacebook', 'Welcome to Thefacebook. This is a temporary CRM time machine.'
    FROM fb04_students
    WHERE name = 'Mark Zuckerberg'
      AND NOT EXISTS (SELECT 1 FROM fb04_wall_posts)
    LIMIT 1
  `;
}

export async function GET(request: NextRequest) {
  if (!isAdmin(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureSchema();

  const { searchParams } = new URL(request.url);
  const search = clean(searchParams.get('search'), 120);
  const year = searchParams.get('graduating_year');
  const sex = clean(searchParams.get('sex'), 40);
  const single = clean(searchParams.get('single_status'), 60);
  const university = clean(searchParams.get('university'), 120);

  const students = await sql`
    SELECT * FROM fb04_students
    WHERE (${search}::text IS NULL OR name ILIKE '%' || ${search} || '%')
      AND (${year || null}::text IS NULL OR graduating_year = (${year})::int)
      AND (${sex}::text IS NULL OR sex = ${sex})
      AND (${single}::text IS NULL OR single_status = ${single})
      AND (${university}::text IS NULL OR university ILIKE '%' || ${university} || '%')
    ORDER BY name ASC
    LIMIT 200
  `;

  const posts = await sql`
    SELECT p.*, s.name AS student_name, s.university,
           COALESCE(l.like_count, 0)::int AS like_count,
           EXISTS(SELECT 1 FROM fb04_likes lx WHERE lx.post_id = p.id AND lx.liker_name = 'Dan') AS liked_by_me
    FROM fb04_wall_posts p
    LEFT JOIN fb04_students s ON s.id = p.student_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS like_count FROM fb04_likes WHERE post_id = p.id
    ) l ON true
    ORDER BY p.created_at DESC
    LIMIT 100
  `;

  const options = await sql`
    SELECT
      ARRAY_REMOVE(ARRAY_AGG(DISTINCT graduating_year ORDER BY graduating_year), NULL) AS years,
      ARRAY_REMOVE(ARRAY_AGG(DISTINCT sex ORDER BY sex), NULL) AS sexes,
      ARRAY_REMOVE(ARRAY_AGG(DISTINCT single_status ORDER BY single_status), NULL) AS statuses,
      ARRAY_REMOVE(ARRAY_AGG(DISTINCT university ORDER BY university), NULL) AS universities
    FROM fb04_students
  `;

  return NextResponse.json({ students, posts, options: options[0] || {} });
}

export async function POST(request: NextRequest) {
  if (!isAdmin(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureSchema();
  const body = await request.json();
  const action = body.action;

  if (action === 'student') {
    const name = clean(body.name, 160);
    if (!name) return NextResponse.json({ error: 'Name required' }, { status: 400 });
    const rows = await sql`
      INSERT INTO fb04_students (name, graduating_year, sex, single_status, university, photo_base64, photo_mime)
      VALUES (${name}, ${body.graduating_year ? Number(body.graduating_year) : null}, ${clean(body.sex, 40)}, ${clean(body.single_status, 60)}, ${clean(body.university, 120)}, ${clean(body.photo_base64, 2_000_000)}, ${clean(body.photo_mime, 80)})
      RETURNING *
    `;
    return NextResponse.json({ success: true, student: rows[0] });
  }

  if (action === 'post') {
    const text = clean(body.body, 2000);
    const image = clean(body.image_base64, 3_500_000);
    if (!text && !image) return NextResponse.json({ error: 'Post text or image required' }, { status: 400 });
    const rows = await sql`
      INSERT INTO fb04_wall_posts (student_id, author_name, body, image_base64, image_mime)
      VALUES (${body.student_id ? Number(body.student_id) : null}, ${clean(body.author_name, 120) || 'Dan'}, ${text}, ${image}, ${clean(body.image_mime, 80)})
      RETURNING *
    `;
    return NextResponse.json({ success: true, post: rows[0] });
  }

  if (action === 'like') {
    const postId = Number(body.post_id);
    if (!postId) return NextResponse.json({ error: 'Post required' }, { status: 400 });
    await sql`
      INSERT INTO fb04_likes (post_id, liker_name)
      VALUES (${postId}, ${clean(body.liker_name, 120) || 'Dan'})
      ON CONFLICT (post_id, liker_name) DO NOTHING
    `;
    return NextResponse.json({ success: true });
  }

  if (action === 'unlike') {
    const postId = Number(body.post_id);
    await sql`DELETE FROM fb04_likes WHERE post_id = ${postId} AND liker_name = ${clean(body.liker_name, 120) || 'Dan'}`;
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
