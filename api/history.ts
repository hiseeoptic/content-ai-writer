/**
 * /api/history — anonymous, browser-id-scoped article history.
 *
 *   GET    /api/history?ownerId=xxx              → HistoryRecord[]
 *   GET    /api/history?ownerId=xxx&id=abc       → HistoryRecord | null
 *   POST   /api/history                          body: { ownerId, record }
 *   DELETE /api/history?ownerId=xxx&id=abc       → { ok: true }
 *   DELETE /api/history?ownerId=xxx              → clears all rows for owner
 *
 * Storage: Vercel Postgres (table `article_history`).
 * If POSTGRES_URL is missing at runtime, the route returns 503 so the
 * frontend can fall back to local IndexedDB / localStorage transparently.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sql } from '@vercel/postgres';

const MAX_RECORDS_PER_OWNER = 30;

const dbConfigured = () => Boolean(process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL);

async function ensureSchema() {
  await sql`
    CREATE TABLE IF NOT EXISTS article_history (
      id          TEXT NOT NULL,
      owner_id    TEXT NOT NULL,
      timestamp   BIGINT NOT NULL,
      mode        TEXT NOT NULL,
      title       TEXT NOT NULL,
      record      JSONB NOT NULL,
      PRIMARY KEY (owner_id, id)
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_history_owner_ts ON article_history (owner_id, timestamp DESC);`;
}

async function listForOwner(ownerId: string) {
  await ensureSchema();
  const { rows } = await sql`
    SELECT record FROM article_history
    WHERE owner_id = ${ownerId}
    ORDER BY timestamp DESC
    LIMIT ${MAX_RECORDS_PER_OWNER};
  `;
  return rows.map((r: any) => r.record);
}

async function getOne(ownerId: string, id: string) {
  await ensureSchema();
  const { rows } = await sql`
    SELECT record FROM article_history
    WHERE owner_id = ${ownerId} AND id = ${id}
    LIMIT 1;
  `;
  return rows[0]?.record ?? null;
}

async function upsert(ownerId: string, record: any) {
  await ensureSchema();
  if (!record?.id || !record?.timestamp || !record?.mode) {
    throw new Error('record must have id, timestamp, and mode');
  }
  await sql`
    INSERT INTO article_history (id, owner_id, timestamp, mode, title, record)
    VALUES (${record.id}, ${ownerId}, ${record.timestamp}, ${record.mode}, ${record.title || ''}, ${JSON.stringify(record)}::jsonb)
    ON CONFLICT (owner_id, id) DO UPDATE
      SET timestamp = EXCLUDED.timestamp,
          mode = EXCLUDED.mode,
          title = EXCLUDED.title,
          record = EXCLUDED.record;
  `;
  // Trim oldest rows if we exceed the per-owner limit.
  await sql`
    DELETE FROM article_history
    WHERE owner_id = ${ownerId}
      AND id IN (
        SELECT id FROM article_history
        WHERE owner_id = ${ownerId}
        ORDER BY timestamp DESC
        OFFSET ${MAX_RECORDS_PER_OWNER}
      );
  `;
}

async function deleteOne(ownerId: string, id: string) {
  await ensureSchema();
  await sql`DELETE FROM article_history WHERE owner_id = ${ownerId} AND id = ${id};`;
}

async function clearAll(ownerId: string) {
  await ensureSchema();
  await sql`DELETE FROM article_history WHERE owner_id = ${ownerId};`;
}

export const config = {
  api: {
    bodyParser: { sizeLimit: '15mb' },
  },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!dbConfigured()) {
    return res.status(503).json({
      ok: false,
      error: 'Postgres not configured. Falling back to local storage.',
      fallback: true,
    });
  }

  try {
    const ownerId = (req.query.ownerId || (req.body && (req.body as any).ownerId) || '') as string;
    if (!ownerId || typeof ownerId !== 'string' || ownerId.length < 4) {
      return res.status(400).json({ ok: false, error: 'ownerId is required' });
    }

    if (req.method === 'GET') {
      const id = (req.query.id || '') as string;
      const data = id ? await getOne(ownerId, id) : await listForOwner(ownerId);
      return res.status(200).json({ ok: true, data });
    }

    if (req.method === 'POST') {
      const record = (req.body as any)?.record;
      if (!record) return res.status(400).json({ ok: false, error: 'record is required' });
      await upsert(ownerId, record);
      return res.status(200).json({ ok: true, data: { id: record.id } });
    }

    if (req.method === 'DELETE') {
      const id = (req.query.id || '') as string;
      if (id) await deleteOne(ownerId, id);
      else await clearAll(ownerId);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (err: any) {
    console.error('[/api/history] error:', err);
    return res.status(500).json({ ok: false, error: err?.message || 'Internal server error' });
  }
}
