// Relatórios calculados a partir do SQLite. Todas as funções recebem o banco para poderem ser testadas.
import type { DatabaseSync } from 'node:sqlite';
import { getSetting } from './db.ts';
import {
  DEFAULT_THRESHOLDS,
  DEFAULT_WEIGHTS,
  FORMAT_LABELS,
  type AlertThresholds,
  type Format,
  type Weights,
  computeAlerts,
  cyclePhase,
  engagementRate,
  formatOf,
  scorePost,
} from './metrics.ts';

const DAY = 86_400_000;

export interface PostRow {
  id: string;
  accountId: string;
  format: Format;
  formatLabel: string;
  caption: string;
  permalink: string;
  thumbnail: string | null;
  timestamp: string;
  reach: number | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  saved: number | null;
  shares: number | null;
  profileVisits: number | null;
  follows: number | null;
  interactions: number | null;
  avgWatchSec: number | null;
  engagementRate: number | null;
  score: number | null;
  scoreParts: Record<string, number>;
  hook: string | null;
  style: string | null;
  pillar: string | null;
  notes: string;
}

export interface PostFilter {
  from?: string; // ISO date
  to?: string;
  format?: Format;
}

export const weightsOf = (db: DatabaseSync) => ({ ...DEFAULT_WEIGHTS, ...getSetting<Partial<Weights>>('weights', {}, db) });
export const thresholdsOf = (db: DatabaseSync) => ({
  ...DEFAULT_THRESHOLDS,
  ...getSetting<Partial<AlertThresholds>>('alerts', {}, db),
});

export function listPosts(db: DatabaseSync, accountId: string, filter: PostFilter = {}): PostRow[] {
  const where = ['m.account_id = ?'];
  const args: (string | number)[] = [accountId];
  if (filter.from) {
    where.push('m.timestamp >= ?');
    args.push(new Date(`${filter.from}T00:00:00`).toISOString());
  }
  if (filter.to) {
    where.push('m.timestamp < ?');
    args.push(new Date(new Date(`${filter.to}T00:00:00`).getTime() + DAY).toISOString());
  }
  const rows = db
    .prepare(
      `SELECT m.*, i.reach, i.views, i.likes AS i_likes, i.comments AS i_comments, i.saved, i.shares,
              i.profile_visits, i.follows, i.total_interactions, i.avg_watch_time_ms,
              t.hook, t.style, t.pillar, t.notes
       FROM media m
       LEFT JOIN media_insights i ON i.media_id = m.id
       LEFT JOIN media_tags t ON t.media_id = m.id
       WHERE ${where.join(' AND ')}
       ORDER BY m.timestamp DESC`,
    )
    .all(...args) as Record<string, any>[];

  const weights = weightsOf(db);
  const posts = rows.map((r): PostRow => {
    const likes = r.i_likes ?? r.like_count;
    const comments = r.i_comments ?? r.comments_count;
    const { score, parts } = scorePost(
      { reach: r.reach, shares: r.shares, saved: r.saved, comments, likes, profile_visits: r.profile_visits },
      weights,
    );
    const format = formatOf(r.media_type, r.product_type);
    const interactions = r.total_interactions ?? sumKnown([likes, comments, r.saved, r.shares]);
    return {
      id: r.id,
      accountId: r.account_id,
      format,
      formatLabel: FORMAT_LABELS[format],
      caption: r.caption ?? '',
      permalink: r.permalink,
      thumbnail: r.thumbnail_url,
      timestamp: r.timestamp,
      reach: r.reach,
      views: r.views,
      likes,
      comments,
      saved: r.saved,
      shares: r.shares,
      profileVisits: r.profile_visits,
      follows: r.follows,
      interactions,
      avgWatchSec: r.avg_watch_time_ms != null ? Math.round(r.avg_watch_time_ms / 100) / 10 : null,
      engagementRate: engagementRate(interactions, r.reach),
      score,
      scoreParts: parts,
      hook: r.hook,
      style: r.style,
      pillar: r.pillar,
      notes: r.notes ?? '',
    };
  });
  return filter.format ? posts.filter((p) => p.format === filter.format) : posts;
}

function sumKnown(values: (number | null | undefined)[]): number | null {
  const known = values.filter((v): v is number => v != null);
  return known.length ? known.reduce((a, b) => a + b, 0) : null;
}

const avg = (values: (number | null)[]) => {
  const known = values.filter((v): v is number => v != null);
  return known.length ? Math.round((known.reduce((a, b) => a + b, 0) / known.length) * 100) / 100 : null;
};

const isoDay = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

interface DailyRow {
  date: string;
  followers: number | null;
  reach: number | null;
  views: number | null;
  accounts_engaged: number | null;
  total_interactions: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
  profile_links_taps: number | null;
}

function daily(db: DatabaseSync, accountId: string, from: string, to: string): DailyRow[] {
  return db
    .prepare('SELECT * FROM account_daily WHERE account_id = ? AND date >= ? AND date <= ? ORDER BY date')
    .all(accountId, from, to) as unknown as DailyRow[];
}

function totals(rows: DailyRow[]) {
  const sum = (k: keyof DailyRow) => sumKnown(rows.map((r) => r[k] as number | null));
  const followers = rows.filter((r) => r.followers != null);
  return {
    reach: sum('reach'),
    views: sum('views'),
    interactions: sum('total_interactions'),
    accountsEngaged: sum('accounts_engaged'),
    shares: sum('shares'),
    saves: sum('saves'),
    profileLinksTaps: sum('profile_links_taps'),
    followers: followers.at(-1)?.followers ?? null,
    followersDelta: followers.length > 1 ? followers.at(-1)!.followers! - followers[0].followers! : null,
  };
}

export interface AccountContext {
  connected: boolean;
  tokenExpiresAt: number | null;
}

/** Relatório completo de uma conta: KPIs, séries, formatos, horários, sinais, público e operação. */
export function accountReport(db: DatabaseSync, accountId: string, days: number, ctx: AccountContext, now = Date.now()) {
  const to = isoDay(now);
  const from = isoDay(now - (days - 1) * DAY);
  const prevTo = isoDay(now - days * DAY);
  const prevFrom = isoDay(now - (2 * days - 1) * DAY);

  const current = daily(db, accountId, from, to);
  const previous = daily(db, accountId, prevFrom, prevTo);
  const posts = listPosts(db, accountId, { from, to });
  const prevPosts = listPosts(db, accountId, { from: prevFrom, to: prevTo });
  const allRecent = listPosts(db, accountId, { from: isoDay(now - Math.max(days, 90) * DAY), to });

  const kpis = {
    ...totals(current),
    posts: posts.length,
    avgScore: avg(posts.map((p) => p.score)),
    avgEngagement: avg(posts.map((p) => p.engagementRate)),
    avgPostReach: avg(posts.map((p) => p.reach)),
  };
  const prevKpis = {
    ...totals(previous),
    posts: prevPosts.length,
    avgScore: avg(prevPosts.map((p) => p.score)),
    avgEngagement: avg(prevPosts.map((p) => p.engagementRate)),
    avgPostReach: avg(prevPosts.map((p) => p.reach)),
  };

  // Formatos e horários usam ao menos 90 dias para ter amostra.
  const byFormat = (Object.keys(FORMAT_LABELS) as Format[])
    .map((format) => {
      const group = allRecent.filter((p) => p.format === format);
      return {
        format,
        label: FORMAT_LABELS[format],
        posts: group.length,
        avgReach: avg(group.map((p) => p.reach)),
        avgScore: avg(group.map((p) => p.score)),
        avgShares: avg(group.map((p) => p.shares)),
        avgSaves: avg(group.map((p) => p.saved)),
        avgEngagement: avg(group.map((p) => p.engagementRate)),
      };
    })
    .filter((f) => f.posts > 0);

  const byWeekday = Array.from({ length: 7 }, (_, wd) => {
    const group = allRecent.filter((p) => new Date(p.timestamp).getDay() === wd);
    return { weekday: wd, posts: group.length, avgReach: avg(group.map((p) => p.reach)), avgScore: avg(group.map((p) => p.score)) };
  });
  const byHour = Array.from({ length: 24 }, (_, h) => {
    const group = allRecent.filter((p) => new Date(p.timestamp).getHours() === h);
    return { hour: h, posts: group.length, avgReach: avg(group.map((p) => p.reach)), avgScore: avg(group.map((p) => p.score)) };
  });

  const online = (db.prepare('SELECT hour, value FROM account_online WHERE account_id = ? ORDER BY hour').all(accountId) as {
    hour: number;
    value: number;
  }[]).map((r) => r.value);

  // Sinais por semana de publicação: a conta ganha compartilhamentos/salvamentos ou só curtidas?
  const weeks = new Map<string, Record<string, number>>();
  for (const p of [...allRecent].reverse()) {
    const d = new Date(p.timestamp);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // segunda-feira
    const key = isoDay(d.getTime());
    const w = weeks.get(key) ?? { posts: 0, shares: 0, saved: 0, comments: 0, likes: 0, profile_visits: 0 };
    w.posts++;
    w.shares += p.shares ?? 0;
    w.saved += p.saved ?? 0;
    w.comments += p.comments ?? 0;
    w.likes += p.likes ?? 0;
    w.profile_visits += p.profileVisits ?? 0;
    weeks.set(key, w);
  }
  const signalsByWeek = [...weeks.entries()].map(([week, v]) => ({ week, ...v }));

  const demographics = db
    .prepare('SELECT audience, breakdown, key, value FROM account_demographics WHERE account_id = ? ORDER BY value DESC')
    .all(accountId) as { audience: string; breakdown: string; key: string; value: number }[];

  const ranked = posts.filter((p) => p.score != null).sort((a, b) => b.score! - a.score!);
  const operational = operationalReport(db, accountId, ctx, now);

  return {
    period: { from, to, days, prevFrom, prevTo },
    kpis,
    prevKpis,
    daily: current,
    byFormat,
    byWeekday,
    byHour,
    online,
    signalsByWeek,
    topPosts: ranked.slice(0, 5),
    bottomPosts: ranked.slice(-5).reverse(),
    demographics,
    operational,
  };
}

export function operationalReport(db: DatabaseSync, accountId: string, ctx: AccountContext, now = Date.now()) {
  const last = db.prepare('SELECT MAX(timestamp) AS t FROM media WHERE account_id = ?').get(accountId) as { t: string | null };
  const daysSinceLastPost = last.t ? Math.floor((now - Date.parse(last.t)) / DAY) : null;
  const postsLast28 = (db
    .prepare('SELECT COUNT(*) AS n FROM media WHERE account_id = ? AND timestamp >= ?')
    .get(accountId, new Date(now - 28 * DAY).toISOString()) as { n: number }).n;

  const reachBetween = (fromMs: number, toMs: number) =>
    (db
      .prepare('SELECT SUM(reach) AS r, COUNT(reach) AS n FROM account_daily WHERE account_id = ? AND date >= ? AND date < ?')
      .get(accountId, isoDay(fromMs), isoDay(toMs)) as { r: number | null; n: number });
  const last7 = reachBetween(now - 7 * DAY, now);
  const prev7 = reachBetween(now - 14 * DAY, now - 7 * DAY);

  const sync = (db.prepare('SELECT * FROM account_sync WHERE account_id = ?').get(accountId) ?? null) as {
    last_attempt_at: number | null;
    last_success_at: number | null;
    last_error: string | null;
  } | null;
  const publishLog = db
    .prepare('SELECT * FROM publish_log WHERE account_id = ? ORDER BY created_at DESC LIMIT 20')
    .all(accountId) as Record<string, unknown>[];
  const failuresLast24h = (db
    .prepare('SELECT COUNT(*) AS n FROM publish_log WHERE account_id = ? AND ok = 0 AND created_at >= ?')
    .get(accountId, now - DAY) as { n: number }).n;

  const tokenDaysLeft = ctx.tokenExpiresAt ? Math.max(0, Math.floor((ctx.tokenExpiresAt - now) / DAY)) : null;
  const alerts = computeAlerts(
    {
      connected: ctx.connected,
      tokenDaysLeft,
      daysSinceLastPost,
      reachLast7: last7.n ? last7.r : null,
      reachPrev7: prev7.n ? prev7.r : null,
      syncError: sync?.last_error ?? null,
      failuresLast24h,
    },
    thresholdsOf(db),
  );

  return {
    lastPostAt: last.t,
    daysSinceLastPost,
    postsPerWeek: Math.round((postsLast28 / 4) * 10) / 10,
    tokenDaysLeft,
    lastSyncAt: sync?.last_success_at ?? null,
    lastSyncAttemptAt: sync?.last_attempt_at ?? null,
    syncError: sync?.last_error ?? null,
    publishLog,
    alerts,
  };
}

/** Ranking das combinações formato + gancho + estilo (só posts com experimento registrado). */
export function experimentReport(db: DatabaseSync, accountId: string) {
  const posts = listPosts(db, accountId).filter((p) => p.hook || p.style);
  const groups = new Map<string, typeof posts>();
  for (const p of posts) {
    const key = [p.formatLabel, p.hook ?? '—', p.style ?? '—'].join(' | ');
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const combos = [...groups.entries()]
    .map(([key, g]) => {
      const [format, hook, style] = key.split(' | ');
      return {
        format,
        hook,
        style,
        posts: g.length,
        avgScore: avg(g.map((p) => p.score)),
        avgReach: avg(g.map((p) => p.reach)),
        avgShares: avg(g.map((p) => p.shares)),
        avgSaves: avg(g.map((p) => p.saved)),
      };
    })
    .sort((a, b) => (b.avgScore ?? -1) - (a.avgScore ?? -1));

  const by = (field: 'hook' | 'style' | 'pillar') => {
    const m = new Map<string, typeof posts>();
    for (const p of posts) if (p[field]) m.set(p[field]!, [...(m.get(p[field]!) ?? []), p]);
    return [...m.entries()]
      .map(([value, g]) => ({ value, posts: g.length, avgScore: avg(g.map((p) => p.score)), avgReach: avg(g.map((p) => p.reach)) }))
      .sort((a, b) => (b.avgScore ?? -1) - (a.avgScore ?? -1));
  };

  return { tagged: posts.length, combos, byHook: by('hook'), byStyle: by('style'), byPillar: by('pillar') };
}

/** Resultado de um ciclo de 10 dias comparado aos 10 dias anteriores. */
export function cycleReport(db: DatabaseSync, accountId: string, startDate: string, now = new Date()) {
  const start = new Date(`${startDate}T00:00:00`).getTime();
  const window = (fromMs: number) => {
    const from = isoDay(fromMs);
    const to = isoDay(fromMs + 9 * DAY);
    const posts = listPosts(db, accountId, { from, to });
    const t = totals(daily(db, accountId, from, to));
    return {
      from,
      to,
      posts: posts.length,
      reach: t.reach,
      interactions: t.interactions,
      followersDelta: t.followersDelta,
      avgScore: avg(posts.map((p) => p.score)),
      bestPost: posts.filter((p) => p.score != null).sort((a, b) => b.score! - a.score!)[0] ?? null,
    };
  };
  return { ...cyclePhase(startDate, now), current: window(start), previous: window(start - 10 * DAY) };
}

/** Score dos posts para impulsionar: bom engajamento por alcance, ainda recente. */
export function boostCandidates(db: DatabaseSync, accountId: string, now = Date.now()) {
  const posts = listPosts(db, accountId, { from: isoDay(now - 45 * DAY) }).filter((p) => p.score != null);
  if (!posts.length) return [];
  const medianReach = median(posts.map((p) => p.reach ?? 0));
  const medianScore = median(posts.map((p) => p.score!));
  return posts
    .map((p) => {
      const ageDays = (now - Date.parse(p.timestamp)) / DAY;
      const reasons: string[] = [];
      if (p.score! >= medianScore * 1.2) reasons.push('engajamento acima da média da conta');
      if ((p.shares ?? 0) + (p.saved ?? 0) > 0) reasons.push('gera compartilhamentos/salvamentos (sinais fortes)');
      if ((p.reach ?? 0) <= medianReach) reasons.push('ainda alcançou pouca gente: espaço para crescer');
      if (ageDays <= 14) reasons.push('publicado recentemente');
      // Prioriza qualidade (score relativo) e frescor.
      const potential = (p.score! / (medianScore || 1)) * (ageDays <= 14 ? 1.2 : 1);
      return { post: p, potential: Math.round(potential * 100) / 100, reasons };
    })
    .filter((c) => c.post.score! >= medianScore)
    .sort((a, b) => b.potential - a.potential)
    .slice(0, 8);
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

