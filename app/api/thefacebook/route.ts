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
    CREATE TABLE IF NOT EXISTS fb04_friendships (
      id SERIAL PRIMARY KEY,
      student_a_id INTEGER NOT NULL REFERENCES fb04_students(id) ON DELETE CASCADE,
      student_b_id INTEGER NOT NULL REFERENCES fb04_students(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(student_a_id, student_b_id),
      CHECK (student_a_id < student_b_id)
    )
  `;
  await sql`
    INSERT INTO fb04_students (name, graduating_year, sex, single_status, university)
    SELECT * FROM (VALUES
      ('Dan Mahler', 2004, 'Male', 'Single', 'Monmouth University'),
      ('Mark Zuckerberg', 2006, 'Male', 'Single', 'Harvard'),
      ('Erica Albright', 2005, 'Female', 'It''s complicated', 'Boston University'),
      ('Eduardo Saverin', 2006, 'Male', 'Single', 'Harvard'),
      ('Christy Lee', 2007, 'Female', 'Single', 'Harvard')
    ) AS seed(name, graduating_year, sex, single_status, university)
    WHERE NOT EXISTS (SELECT 1 FROM fb04_students)
  `;
  await sql`
    INSERT INTO fb04_friendships (student_a_id, student_b_id)
    SELECT LEAST(me.id, s.id), GREATEST(me.id, s.id)
    FROM fb04_students me
    JOIN fb04_students s ON s.id <> me.id
    WHERE me.name = 'Dan Mahler'
      AND NOT EXISTS (SELECT 1 FROM fb04_friendships)
  `;
  await sql`
    INSERT INTO fb04_wall_posts (student_id, author_name, body)
    SELECT id, name, 'Just joined GradMate. Stories only. No permanent wall photos.'
    FROM fb04_students
    WHERE name = 'Dan Mahler'
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
  const meRows = await sql`SELECT id FROM fb04_students WHERE name = 'Dan Mahler' ORDER BY id LIMIT 1`;
  const meId = Number(meRows[0]?.id || 0);

  const students = await sql`
    SELECT s.*,
           EXISTS (
             SELECT 1 FROM fb04_friendships f
             WHERE f.student_a_id = LEAST(${meId}, s.id)
               AND f.student_b_id = GREATEST(${meId}, s.id)
           ) AS is_friend
    FROM fb04_students s
    WHERE (${search}::text IS NULL OR s.name ILIKE '%' || ${search} || '%')
      AND (${year || null}::text IS NULL OR s.graduating_year = (${year})::int)
      AND (${sex}::text IS NULL OR s.sex = ${sex})
      AND (${single}::text IS NULL OR s.single_status = ${single})
      AND (${university}::text IS NULL OR s.university ILIKE '%' || ${university} || '%')
    ORDER BY s.name ASC
    LIMIT 200
  `;

  const stories = await sql`
    SELECT p.*, s.name AS student_name, s.university, s.photo_base64, s.photo_mime,
           COALESCE(l.like_count, 0)::int AS like_count,
           EXISTS(SELECT 1 FROM fb04_likes lx WHERE lx.post_id = p.id AND lx.liker_name = 'Dan') AS liked_by_me
    FROM fb04_wall_posts p
    LEFT JOIN fb04_students s ON s.id = p.student_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS like_count FROM fb04_likes WHERE post_id = p.id
    ) l ON true
    WHERE p.student_id = ${meId}
       OR EXISTS (
         SELECT 1 FROM fb04_friendships f
         WHERE f.student_a_id = LEAST(${meId}, COALESCE(p.student_id, 0))
           AND f.student_b_id = GREATEST(${meId}, COALESCE(p.student_id, 0))
       )
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

  return NextResponse.json({ students, stories, posts: stories, me_id: meId, options: options[0] || {} });
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

  if (action === 'post' || action === 'story') {
    const text = clean(body.body, 2000);
    const studentId = body.student_id ? Number(body.student_id) : null;
    if (!text) return NextResponse.json({ error: 'Story text required' }, { status: 400 });
    const authorRows = studentId
      ? await sql`SELECT name FROM fb04_students WHERE id = ${studentId} LIMIT 1`
      : await sql`SELECT id, name FROM fb04_students WHERE name = 'Dan Mahler' ORDER BY id LIMIT 1`;
    const finalStudentId = studentId || Number(authorRows[0]?.id || 0) || null;
    const authorName = clean(body.author_name, 120) || String(authorRows[0]?.name || 'Dan');
    const rows = await sql`
      INSERT INTO fb04_wall_posts (student_id, author_name, body, image_base64, image_mime)
      VALUES (${finalStudentId}, ${authorName}, ${text}, NULL, NULL)
      RETURNING *
    `;
    return NextResponse.json({ success: true, story: rows[0], post: rows[0] });
  }

  if (action === 'friend') {
    const meRows = await sql`SELECT id FROM fb04_students WHERE name = 'Dan Mahler' ORDER BY id LIMIT 1`;
    const meId = Number(meRows[0]?.id || 0);
    const otherId = Number(body.student_id);
    if (!meId || !otherId || meId === otherId) return NextResponse.json({ error: 'Student required' }, { status: 400 });
    await sql`
      INSERT INTO fb04_friendships (student_a_id, student_b_id)
      VALUES (LEAST(${meId}, ${otherId}), GREATEST(${meId}, ${otherId}))
      ON CONFLICT (student_a_id, student_b_id) DO NOTHING
    `;
    return NextResponse.json({ success: true });
  }

  if (action === 'unfriend') {
    const meRows = await sql`SELECT id FROM fb04_students WHERE name = 'Dan Mahler' ORDER BY id LIMIT 1`;
    const meId = Number(meRows[0]?.id || 0);
    const otherId = Number(body.student_id);
    await sql`DELETE FROM fb04_friendships WHERE student_a_id = LEAST(${meId}, ${otherId}) AND student_b_id = GREATEST(${meId}, ${otherId})`;
    return NextResponse.json({ success: true });
  }

  if (action === 'like') {
    const postId = Number(body.post_id);
    if (!postId) return NextResponse.json({ error: 'Story required' }, { status: 400 });
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
