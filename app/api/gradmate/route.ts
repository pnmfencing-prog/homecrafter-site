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
    CREATE TABLE IF NOT EXISTS fb04_taps (
      id SERIAL PRIMARY KEY,
      from_student_id INTEGER NOT NULL REFERENCES fb04_students(id) ON DELETE CASCADE,
      to_student_id INTEGER NOT NULL REFERENCES fb04_students(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(from_student_id, to_student_id),
      CHECK (from_student_id <> to_student_id)
    )
  `;
  await sql`
    INSERT INTO fb04_students (name, graduating_year, sex, single_status, university)
    SELECT * FROM (VALUES
      ('Dan Mahler', 2005, 'Male', 'Single', 'Monmouth University'),
      ('Alyssa Marino', 2005, 'Female', 'Single', 'Rutgers'),
      ('Brian McCarthy', 2006, 'Male', 'Single', 'Monmouth University'),
      ('Casey Bennett', 2005, 'Female', 'In a relationship', 'Princeton'),
      ('Chris Romano', 2004, 'Male', 'It''s complicated', 'Seton Hall'),
      ('Dana Klein', 2007, 'Female', 'Single', 'NYU'),
      ('Eddie Walsh', 2005, 'Male', 'Single', 'Rutgers'),
      ('Erin Callahan', 2006, 'Female', 'Single', 'Boston College'),
      ('Frankie Russo', 2004, 'Male', 'In a relationship', 'Villanova'),
      ('Grace Donnelly', 2005, 'Female', 'Single', 'Georgetown'),
      ('Hannah Lee', 2007, 'Female', 'It''s complicated', 'Columbia'),
      ('Jack O''Brien', 2006, 'Male', 'Single', 'Penn State'),
      ('Jamie Torres', 2005, 'Other', 'Single', 'Temple'),
      ('Katie Sullivan', 2004, 'Female', 'Single', 'Monmouth University'),
      ('Kevin Patel', 2007, 'Male', 'Single', 'Rutgers'),
      ('Lauren Fisher', 2006, 'Female', 'In a relationship', 'Syracuse'),
      ('Matt DeLuca', 2005, 'Male', 'Single', 'Fordham'),
      ('Megan Reilly', 2004, 'Female', 'Single', 'Providence'),
      ('Mike Rosen', 2007, 'Male', 'It''s complicated', 'NYU'),
      ('Nina Brooks', 2006, 'Female', 'Single', 'Boston University'),
      ('Patrick Shea', 2005, 'Male', 'Single', 'Lehigh'),
      ('Rachel Stein', 2004, 'Female', 'In a relationship', 'Cornell'),
      ('Sam Goldberg', 2007, 'Male', 'Single', 'University of Delaware'),
      ('Tara Murphy', 2005, 'Female', 'Single', 'Loyola Maryland'),
      ('Tommy Novak', 2006, 'Male', 'Single', 'Drexel'),
      ('Victoria King', 2004, 'Female', 'It''s complicated', 'Villanova')
    ) AS seed(name, graduating_year, sex, single_status, university)
    WHERE NOT EXISTS (SELECT 1 FROM fb04_students WHERE fb04_students.name = seed.name)
  `;
  await sql`
    INSERT INTO fb04_friendships (student_a_id, student_b_id)
    SELECT LEAST(me.id, s.id), GREATEST(me.id, s.id)
    FROM fb04_students me
    JOIN fb04_students s ON s.id <> me.id
    WHERE me.name = 'Dan Mahler'
      AND s.name IN ('Alyssa Marino', 'Brian McCarthy', 'Katie Sullivan', 'Matt DeLuca', 'Tara Murphy')
    ON CONFLICT (student_a_id, student_b_id) DO NOTHING
  `;
  await sql`
    INSERT INTO fb04_wall_posts (student_id, author_name, body)
    SELECT s.id, s.name, seed.body
    FROM (VALUES
      ('Dan Mahler', 'GradMate feels like college internet again.'),
      ('Alyssa Marino', 'Library until 8 then maybe the student center.'),
      ('Brian McCarthy', 'Anyone going out after the game?'),
      ('Katie Sullivan', 'New profile pic finally.'),
      ('Matt DeLuca', 'If anyone has econ notes, tap me.'),
      ('Tara Murphy', 'Beach day after finals?'),
      ('Grace Donnelly', 'Formal tickets are impossible this year.'),
      ('Patrick Shea', 'Who has the good dining hall guest swipes?'),
      ('Nina Brooks', 'Coffee, psych paper, repeat.'),
      ('Tommy Novak', 'Intramural game at 6. Need one more.'),
      ('Lauren Fisher', 'Road trip playlist is officially elite.'),
      ('Kevin Patel', 'Tap me if you are in Calc II.'),
      ('Megan Reilly', 'Finals week survival mode.'),
      ('Sam Goldberg', 'Just changed my profile. Be honest.'),
      ('Victoria King', 'Library is somehow louder than the quad.')
    ) AS seed(name, body)
    JOIN fb04_students s ON s.name = seed.name
    WHERE NOT EXISTS (
      SELECT 1 FROM fb04_wall_posts p
      WHERE p.student_id = s.id AND p.body = seed.body
    )
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
           ) AS is_friend,
           EXISTS (
             SELECT 1 FROM fb04_taps t
             WHERE t.from_student_id = ${meId}
               AND t.to_student_id = s.id
           ) AS tapped_by_me,
           EXISTS (
             SELECT 1 FROM fb04_taps t
             WHERE t.from_student_id = s.id
               AND t.to_student_id = ${meId}
           ) AS tapped_me
    FROM fb04_students s
    WHERE (${search}::text IS NULL OR s.name ILIKE '%' || ${search} || '%')
      AND (${year || null}::text IS NULL OR s.graduating_year = (${year})::int)
      AND (${sex}::text IS NULL OR s.sex = ${sex})
      AND (${single}::text IS NULL OR s.single_status = ${single})
      AND (${university}::text IS NULL OR s.university ILIKE '%' || ${university} || '%')
    ORDER BY CASE WHEN s.id = ${meId} THEN 0 ELSE 1 END, s.name ASC
    LIMIT 200
  `;

  const stories = await sql`
    SELECT p.*, s.name AS student_name, s.university, s.graduating_year, s.sex, s.single_status, s.photo_base64, s.photo_mime,
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

  if (action === 'post' || action === 'story') {
    const text = clean(body.body, 140);
    const media = clean(body.media_base64, 6_000_000);
    const mediaMime = clean(body.media_mime, 80);
    const studentId = body.student_id ? Number(body.student_id) : null;
    if (!text && !media) return NextResponse.json({ error: 'Story text or media required' }, { status: 400 });
    const authorRows = studentId
      ? await sql`SELECT id, name FROM fb04_students WHERE id = ${studentId} LIMIT 1`
      : await sql`SELECT id, name FROM fb04_students WHERE name = 'Dan Mahler' ORDER BY id LIMIT 1`;
    const finalStudentId = studentId || Number(authorRows[0]?.id || 0) || null;
    const authorName = clean(body.author_name, 120) || String(authorRows[0]?.name || 'Dan');
    const rows = await sql`
      INSERT INTO fb04_wall_posts (student_id, author_name, body, image_base64, image_mime)
      VALUES (${finalStudentId}, ${authorName}, ${text}, ${media}, ${mediaMime})
      RETURNING *
    `;
    return NextResponse.json({ success: true, story: rows[0], post: rows[0] });
  }

  if (action === 'friend' || action === 'unfriend' || action === 'tap') {
    const meRows = await sql`SELECT id FROM fb04_students WHERE name = 'Dan Mahler' ORDER BY id LIMIT 1`;
    const meId = Number(meRows[0]?.id || 0);
    const otherId = Number(body.student_id);
    if (!meId || !otherId || meId === otherId) return NextResponse.json({ error: 'Student required' }, { status: 400 });

    if (action === 'friend') {
      await sql`
        INSERT INTO fb04_friendships (student_a_id, student_b_id)
        VALUES (LEAST(${meId}, ${otherId}), GREATEST(${meId}, ${otherId}))
        ON CONFLICT (student_a_id, student_b_id) DO NOTHING
      `;
      return NextResponse.json({ success: true });
    }
    if (action === 'unfriend') {
      await sql`DELETE FROM fb04_friendships WHERE student_a_id = LEAST(${meId}, ${otherId}) AND student_b_id = GREATEST(${meId}, ${otherId})`;
      return NextResponse.json({ success: true });
    }
    await sql`
      INSERT INTO fb04_taps (from_student_id, to_student_id)
      VALUES (${meId}, ${otherId})
      ON CONFLICT (from_student_id, to_student_id) DO UPDATE SET created_at = NOW()
    `;
    return NextResponse.json({ success: true });
  }

  if (action === 'like' || action === 'unlike') {
    const postId = Number(body.post_id);
    if (!postId) return NextResponse.json({ error: 'Story required' }, { status: 400 });
    if (action === 'like') {
      await sql`
        INSERT INTO fb04_likes (post_id, liker_name)
        VALUES (${postId}, ${clean(body.liker_name, 120) || 'Dan'})
        ON CONFLICT (post_id, liker_name) DO NOTHING
      `;
    } else {
      await sql`DELETE FROM fb04_likes WHERE post_id = ${postId} AND liker_name = ${clean(body.liker_name, 120) || 'Dan'}`;
    }
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
