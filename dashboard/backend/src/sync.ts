// Sincronização Instagram -> SQLite. Idempotente (sempre UPSERT): pode rodar quantas vezes quiser.
// Uma conta com erro é registrada em account_sync e não interrompe as outras.
import { ACCOUNTS } from './config.ts';
import { db, getSetting, setSetting, transaction } from './db.ts';
import * as ig from './instagram.ts';
import { connectionToken, read } from './store.ts';

const DAY = 24 * 60 * 60 * 1000;
const running = new Set<string>();

/** Data local AAAA-MM-DD. */
export function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function isSyncing(accountId: string): boolean {
  return running.has(accountId);
}

export async function syncAll(): Promise<void> {
  for (const a of ACCOUNTS) await syncAccount(a.id);
}

export async function syncAccount(accountId: string): Promise<{ ok: boolean; error?: string }> {
  const conn = read().connections[accountId];
  if (!conn || conn.tokenExpiresAt < Date.now() || running.has(accountId)) return { ok: false };
  running.add(accountId);
  const token = connectionToken(accountId)!;
  db.prepare(
    `INSERT INTO account_sync(account_id, last_attempt_at) VALUES(?, ?)
     ON CONFLICT(account_id) DO UPDATE SET last_attempt_at = excluded.last_attempt_at`,
  ).run(accountId, Date.now());

  const problems: string[] = [];
  try {
    const profile = await ig.getProfile(token);
    upsertDaily(accountId, localDate(new Date()), { followers: profile.followers_count ?? null });

    await syncMedia(accountId, conn.igUserId, token, problems);
    await syncAccountDays(accountId, conn.igUserId, token, problems);
    await syncAudience(accountId, conn.igUserId, token, problems);
  } catch (e) {
    problems.unshift((e as Error).message);
  } finally {
    running.delete(accountId);
  }

  const error = problems.length ? summarize(problems) : null;
  db.prepare(
    `UPDATE account_sync SET last_error = ?, last_success_at = CASE WHEN ? IS NULL THEN ? ELSE last_success_at END
     WHERE account_id = ?`,
  ).run(error, error, Date.now(), accountId);
  return { ok: !error, error: error ?? undefined };
}

function summarize(problems: string[]): string {
  const unique = [...new Set(problems)];
  const text = unique.slice(0, 3).join(' | ');
  if (/permission|permiss|scope|\(#10\)|#200/i.test(text)) {
    return `${text} — Reconecte a conta para liberar as métricas (nova permissão de insights).`;
  }
  return text;
}

async function syncMedia(accountId: string, igUserId: string, token: string, problems: string[]): Promise<void> {
  const known = (db.prepare('SELECT COUNT(*) AS n FROM media WHERE account_id = ?').get(accountId) as { n: number }).n;
  // Primeira vez: 1 ano de histórico. Depois: 90 dias (métricas de posts recentes ainda mudam).
  const since = Date.now() - (known ? 90 : 365) * DAY;
  const media = await ig.getMediaSince(igUserId, token, since);

  const upsert = db.prepare(
    `INSERT INTO media(id, account_id, media_type, product_type, caption, permalink, thumbnail_url, timestamp,
                       like_count, comments_count, synced_at)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET caption = excluded.caption, thumbnail_url = excluded.thumbnail_url,
       like_count = excluded.like_count, comments_count = excluded.comments_count, synced_at = excluded.synced_at,
       product_type = excluded.product_type`,
  );
  transaction(() => {
    for (const m of media) {
      upsert.run(
        m.id, accountId, m.media_type, m.media_product_type ?? null, m.caption ?? null, m.permalink,
        m.media_type === 'VIDEO' ? (m.thumbnail_url ?? null) : (m.media_url ?? m.thumbnail_url ?? null),
        m.timestamp, m.like_count ?? null, m.comments_count ?? null, Date.now(),
      );
    }
  });

  const saveInsights = db.prepare(
    `INSERT INTO media_insights(media_id, reach, views, likes, comments, saved, shares, total_interactions,
                                profile_visits, follows, reposts, avg_watch_time_ms, synced_at)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(media_id) DO UPDATE SET reach = excluded.reach, views = excluded.views, likes = excluded.likes,
       comments = excluded.comments, saved = excluded.saved, shares = excluded.shares,
       total_interactions = excluded.total_interactions, profile_visits = excluded.profile_visits,
       follows = excluded.follows, reposts = excluded.reposts, avg_watch_time_ms = excluded.avg_watch_time_ms,
       synced_at = excluded.synced_at`,
  );
  for (const m of media) {
    if (m.media_product_type === 'STORY' || m.media_product_type === 'AD') continue;
    try {
      const i = await ig.getMediaInsights(m.id, m.media_product_type, token);
      saveInsights.run(
        m.id, i.reach ?? null, i.views ?? null, i.likes ?? m.like_count ?? null, i.comments ?? m.comments_count ?? null,
        i.saved ?? null, i.shares ?? null, i.total_interactions ?? null, i.profile_visits ?? null, i.follows ?? null,
        i.reposts ?? null, i.ig_reels_avg_watch_time ?? null, Date.now(),
      );
    } catch (e) {
      problems.push((e as Error).message);
      if (problems.length > 5) break; // provável falta de permissão: não insiste em todas as mídias
    }
  }
}

async function syncAccountDays(accountId: string, igUserId: string, token: string, problems: string[]): Promise<void> {
  const last = db
    .prepare('SELECT MAX(date) AS d FROM account_daily WHERE account_id = ? AND reach IS NOT NULL')
    .get(accountId) as { d: string | null };
  // A Meta pode atrasar até 48h: refaz sempre os últimos 3 dias. Primeira vez: 28 dias.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - 28);
  if (last.d) {
    const fromLast = new Date(`${last.d}T00:00:00`);
    fromLast.setDate(fromLast.getDate() - 3);
    if (fromLast > start) start.setTime(fromLast.getTime());
  }
  for (const day = new Date(start); day <= today; day.setDate(day.getDate() + 1)) {
    const next = new Date(day);
    next.setDate(next.getDate() + 1);
    try {
      const totals = await ig.getAccountTotals(igUserId, token, day.getTime() / 1000, next.getTime() / 1000);
      upsertDaily(accountId, localDate(day), totals);
    } catch (e) {
      problems.push((e as Error).message);
      return;
    }
  }
}

async function syncAudience(accountId: string, igUserId: string, token: string, problems: string[]): Promise<void> {
  const key = `audience-synced:${accountId}`;
  if (getSetting<number>(key, 0) > Date.now() - DAY) return; // 1x por dia basta

  const save = db.prepare(
    `INSERT INTO account_demographics(account_id, audience, breakdown, key, value) VALUES(?, ?, ?, ?, ?)
     ON CONFLICT DO UPDATE SET value = excluded.value`,
  );
  for (const [audience, metric] of [
    ['followers', 'follower_demographics'],
    ['engaged', 'engaged_audience_demographics'],
  ] as const) {
    try {
      const demo = await ig.getDemographics(igUserId, token, metric);
      transaction(() => {
        db.prepare('DELETE FROM account_demographics WHERE account_id = ? AND audience = ?').run(accountId, audience);
        for (const [breakdown, values] of Object.entries(demo)) {
          for (const [k, v] of Object.entries(values)) save.run(accountId, audience, breakdown, k, v);
        }
      });
    } catch {
      // Contas com menos de 100 seguidores/engajamentos não têm demografia: não é erro.
    }
  }
  try {
    const hours = await ig.getOnlineFollowers(igUserId, token);
    const saveHour = db.prepare(
      `INSERT INTO account_online(account_id, hour, value) VALUES(?, ?, ?)
       ON CONFLICT DO UPDATE SET value = excluded.value`,
    );
    if (hours.some(Boolean)) transaction(() => hours.forEach((v, h) => saveHour.run(accountId, h, v)));
  } catch (e) {
    problems.push((e as Error).message);
  }
  setSetting(key, Date.now());
}

const DAILY_COLUMNS = [
  'followers', 'reach', 'views', 'accounts_engaged', 'total_interactions', 'likes', 'comments', 'saves', 'shares',
  'profile_links_taps',
] as const;

/** Atualiza só as colunas informadas da linha do dia. */
export function upsertDaily(accountId: string, date: string, values: Partial<Record<(typeof DAILY_COLUMNS)[number], number | null>>, database = db): void {
  const cols = DAILY_COLUMNS.filter((c) => values[c] !== undefined);
  if (!cols.length) return;
  database
    .prepare(
      `INSERT INTO account_daily(account_id, date, ${cols.join(', ')}) VALUES(?, ?, ${cols.map(() => '?').join(', ')})
       ON CONFLICT(account_id, date) DO UPDATE SET ${cols.map((c) => `${c} = excluded.${c}`).join(', ')}`,
    )
    .run(accountId, date, ...cols.map((c) => values[c] ?? null));
}
