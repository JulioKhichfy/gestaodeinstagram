// Descoberta de perfis: busca por hashtag, Business Discovery e sugestões por afinidade.
// Limites da API oficial: não há busca de usuários, lista de seguidores de terceiros, follow/unfollow nem DM.
// A busca por hashtag devolve posts sem o username do autor; os perfis saem das @menções nas legendas.
// Nada é enviado a ninguém: o contato é sempre manual, pelo link do perfil.
import type { DatabaseSync } from 'node:sqlite';
import { ACCOUNTS } from './config.ts';
import type { DiscoveryClient, HashtagMedia, PublicProfile } from './facebook.ts';
import { InstagramError } from './instagram.ts';
import { listPosts } from './report.ts';

const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;

export const HASHTAG_LIMIT = 30;
export const HASHTAG_WINDOW = WEEK;
export const CACHE_TTL = DAY;
export const PROFILE_TTL = DAY;
/** Máximo de consultas Business Discovery por pedido, para não estourar o limite de uso da Graph API. */
export const LOOKUPS_PER_REQUEST = 15;

export const STATUSES = ['novo', 'salvo', 'descartado', 'em_contato'] as const;
export type DiscoveryStatus = (typeof STATUSES)[number];

export class DiscoveryError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Conta do Instagram (vinculada a uma Página) que faz as consultas, e o token do Facebook. */
export interface DiscoveryConn {
  igUserId: string;
  token: string;
  viaAccountId: string;
}

const OWN_USERNAMES = new Set(ACCOUNTS.map((a) => a.username.toLowerCase()));
const USERNAME_RE = /^[a-z0-9._]{1,30}$/;

/** "Decoração Afetiva!" -> "decoracaoafetiva" (minúsculo, sem acento, sem espaço nem pontuação). */
export function normalizeTerm(q: string): string {
  return q
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 100);
}

/** Aceita "@nome", "nome" ou o link do perfil. Devolve null se não for um username válido. */
export function normalizeUsername(input: string): string | null {
  const s = input
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/^@/, '')
    .replace(/[/?#].*$/, '')
    .toLowerCase();
  return USERNAME_RE.test(s) ? s : null;
}

export function extractMentions(text: string | null | undefined): string[] {
  const out: string[] = [];
  for (const m of (text ?? '').matchAll(/(?:^|[^\w.@])@([A-Za-z0-9._]{1,30})/g)) {
    const u = m[1].toLowerCase().replace(/\.+$/, '');
    if (USERNAME_RE.test(u)) out.push(u);
  }
  return out;
}

export function extractHashtags(text: string | null | undefined): string[] {
  return [...(text ?? '').matchAll(/#([\p{L}\p{N}_]+)/gu)].map((m) => normalizeTerm(m[1])).filter(Boolean);
}

function countBy(items: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const i of items) m.set(i, (m.get(i) ?? 0) + 1);
  return m;
}

const json = <T>(s: string | null | undefined, fallback: T): T => (s ? (JSON.parse(s) as T) : fallback);

// ---------- Limite de hashtags ----------

export function hashtagUsage(db: DatabaseSync, accountId: string, now = Date.now()) {
  const rows = db
    .prepare(
      `SELECT hashtag, MAX(queried_at) AS last FROM hashtag_usage
       WHERE account_id = ? AND queried_at > ? GROUP BY hashtag ORDER BY last`,
    )
    .all(accountId, now - HASHTAG_WINDOW) as { hashtag: string; last: number }[];
  return {
    used: rows.length,
    limit: HASHTAG_LIMIT,
    remaining: Math.max(0, HASHTAG_LIMIT - rows.length),
    hashtags: rows.map((r) => ({ hashtag: r.hashtag, queriedAt: r.last, freesAt: r.last + HASHTAG_WINDOW })),
  };
}

// ---------- Perfis descobertos ----------

interface ProfileRow {
  id: number;
  account_id: string;
  username: string;
  ig_user_id: string | null;
  source: string;
  watch: number;
  mention_count: number;
  hashtags: string;
  available: number | null;
  error: string | null;
  data: string | null;
  followers: number | null;
  avg_engagement: number | null;
  posts_per_week: number | null;
  niche: string | null;
  affinity: number;
  reasons: string;
  status: DiscoveryStatus;
  notes: string;
  fetched_at: number | null;
  created_at: number;
}

export interface PublicSummary {
  name: string;
  biography: string;
  website: string;
  picture: string | null;
  follows: number | null;
  mediaCount: number | null;
  lastPostAt: string | null;
  topHashtags: string[];
  recent: { permalink: string; mediaType: string; likes: number | null; comments: number | null; timestamp: string }[];
}

function upsertCandidate(
  db: DatabaseSync,
  accountId: string,
  username: string,
  patch: { source: 'hashtag' | 'afinidade' | 'manual'; hashtag?: string; mentionCount?: number; watch?: boolean },
  now: number,
): void {
  db.prepare(
    `INSERT INTO discovered_profiles(account_id, username, source, created_at, updated_at) VALUES(?, ?, ?, ?, ?)
     ON CONFLICT(account_id, username) DO NOTHING`,
  ).run(accountId, username, patch.source, now, now);
  const row = db
    .prepare('SELECT * FROM discovered_profiles WHERE account_id = ? AND username = ?')
    .get(accountId, username) as unknown as ProfileRow;
  const hashtags = json<string[]>(row.hashtags, []);
  if (patch.hashtag && !hashtags.includes(patch.hashtag)) hashtags.push(patch.hashtag);
  db.prepare('UPDATE discovered_profiles SET hashtags = ?, mention_count = ?, watch = ? WHERE id = ?').run(
    JSON.stringify(hashtags.slice(-20)),
    patch.mentionCount ?? row.mention_count,
    patch.watch ? 1 : row.watch,
    row.id,
  );
}

/** Resumo público de um perfil (Business Discovery) e as médias calculadas a partir das mídias públicas. */
export function summarize(p: PublicProfile, now = Date.now()) {
  const media = p.media?.data ?? [];
  const followers = p.followers_count ?? null;
  const rates = followers
    ? media.filter((m) => m.like_count != null).map((m) => (((m.like_count ?? 0) + (m.comments_count ?? 0)) / followers) * 100)
    : [];
  const times = media.map((m) => Date.parse(m.timestamp ?? '')).filter(Number.isFinite);
  const oldest = times.length ? Math.min(...times) : null;
  const newest = times.length ? Math.max(...times) : null;
  const tags = [...countBy(media.flatMap((m) => extractHashtags(m.caption)))].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  const data: PublicSummary = {
    name: p.name ?? '',
    biography: (p.biography ?? '').slice(0, 400),
    website: p.website ?? '',
    picture: p.profile_picture_url ?? null,
    follows: p.follows_count ?? null,
    mediaCount: p.media_count ?? null,
    lastPostAt: newest ? new Date(newest).toISOString() : null,
    topHashtags: tags.slice(0, 15),
    recent: media.slice(0, 6).map((m) => ({
      permalink: m.permalink ?? '',
      mediaType: m.media_type ?? '',
      likes: m.like_count ?? null,
      comments: m.comments_count ?? null,
      timestamp: m.timestamp ?? '',
    })),
  };
  return {
    igUserId: p.id ?? null,
    followers,
    avgEngagement: rates.length ? round(rates.reduce((a, b) => a + b, 0) / rates.length) : null,
    postsPerWeek: oldest != null ? round(times.length / Math.max(1, (now - oldest) / WEEK)) : null,
    niche: tags.slice(0, 3).map((t) => `#${t}`).join(' · ') || null,
    data,
  };
}

const round = (v: number) => Math.round(v * 100) / 100;

/** Consulta (ou reaproveita, se tiver menos de 24h) os dados públicos de cada username. */
async function refreshProfiles(
  db: DatabaseSync,
  client: DiscoveryClient,
  conn: DiscoveryConn,
  accountId: string,
  usernames: string[],
  now: number,
): Promise<number> {
  const stale = usernames.filter((u) => {
    const r = db
      .prepare('SELECT fetched_at FROM discovered_profiles WHERE account_id = ? AND username = ?')
      .get(accountId, u) as { fetched_at: number | null } | undefined;
    return !r?.fetched_at || r.fetched_at < now - PROFILE_TTL;
  });
  for (const username of stale.slice(0, LOOKUPS_PER_REQUEST)) {
    try {
      const s = summarize(await client.businessDiscovery(conn.igUserId, conn.token, username), now);
      db.prepare(
        `UPDATE discovered_profiles SET ig_user_id = ?, available = 1, error = NULL, data = ?, followers = ?,
           avg_engagement = ?, posts_per_week = ?, niche = ?, fetched_at = ?
         WHERE account_id = ? AND username = ?`,
      ).run(s.igUserId, JSON.stringify(s.data), s.followers, s.avgEngagement, s.postsPerWeek, s.niche, now, accountId, username);
    } catch (e) {
      const code = e instanceof InstagramError ? e.code : undefined;
      if (code === 190) throw new DiscoveryError(401, 'O acesso do Facebook expirou ou foi revogado. Reconecte o Facebook.');
      if (code === 10 || code === 200) throw new DiscoveryError(403, `A Meta negou a consulta de perfis: ${(e as Error).message}`);
      if (code === 4 || code === 17 || code === 32 || code === 613) break; // limite de uso: tenta o resto mais tarde
      if (!(e instanceof InstagramError)) throw e;
      db.prepare(
        'UPDATE discovered_profiles SET available = 0, error = ?, fetched_at = ? WHERE account_id = ? AND username = ?',
      ).run('Conta pessoal, privada ou inexistente: a Meta só mostra dados de contas profissionais.', now, accountId, username);
    }
  }
  return Math.max(0, stale.length - LOOKUPS_PER_REQUEST);
}

// ---------- Afinidade ----------

/** Hashtags da própria conta, com peso maior para as usadas nos posts de melhor score. */
export function ownHashtagWeights(db: DatabaseSync, accountId: string): Map<string, number> {
  const posts = listPosts(db, accountId);
  const scores = posts.map((p) => p.score).filter((s): s is number => s != null).sort((a, b) => a - b);
  const median = scores.length ? scores[Math.floor(scores.length / 2)] : 0;
  const weights = new Map<string, number>();
  for (const p of posts) {
    const w = 1 + (p.score != null && median > 0 ? Math.min(3, p.score / median) : 0);
    for (const t of new Set(extractHashtags(p.caption))) weights.set(t, (weights.get(t) ?? 0) + w);
  }
  return new Map([...weights].sort((a, b) => b[1] - a[1]).slice(0, 30));
}

/** Perfis que a própria conta já mencionou nas legendas (fora as contas do próprio dashboard). */
export function ownMentions(db: DatabaseSync, accountId: string): Map<string, number> {
  const rows = db.prepare('SELECT caption FROM media WHERE account_id = ?').all(accountId) as { caption: string | null }[];
  return countBy(rows.flatMap((r) => [...new Set(extractMentions(r.caption))]).filter((u) => !OWN_USERNAMES.has(u)));
}

export function computeAffinity(
  p: { watch: boolean; mentionCount: number; hashtags: string[]; topHashtags: string[]; lastPostAt: string | null; postsPerWeek: number | null },
  own: Map<string, number>,
  now = Date.now(),
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  const maxW = Math.max(0, ...own.values());
  const shared = p.topHashtags.filter((t) => own.has(t));
  if (shared.length && maxW > 0) {
    score += Math.min(45, shared.reduce((sum, t) => sum + (15 * own.get(t)!) / maxW, 0));
    reasons.push(`Publica com hashtags que também funcionam na sua conta: ${shared.slice(0, 4).map((t) => `#${t}`).join(', ')}`);
  }
  if (p.mentionCount > 0) {
    score += Math.min(25, 10 * p.mentionCount);
    reasons.push(`Você já mencionou este perfil em ${p.mentionCount} ${p.mentionCount === 1 ? 'post' : 'posts'}`);
  }
  if (p.hashtags.length) {
    score += Math.min(15, 8 * p.hashtags.length);
    reasons.push(`Mencionado em posts de ${p.hashtags.slice(0, 4).map((t) => `#${t}`).join(', ')}`);
  }
  if (p.watch) {
    score += 15;
    reasons.push('Cadastrado por você como concorrente ou referência');
  }
  if (p.lastPostAt && now - Date.parse(p.lastPostAt) < 30 * DAY) {
    score += 5;
    if (p.postsPerWeek) reasons.push(`Ativo: cerca de ${p.postsPerWeek.toLocaleString('pt-BR')} posts por semana`);
  }
  return { score: Math.round(Math.min(100, score)), reasons };
}

function recomputeAffinity(db: DatabaseSync, accountId: string, own: Map<string, number>, now: number): void {
  const rows = db.prepare('SELECT * FROM discovered_profiles WHERE account_id = ?').all(accountId) as unknown as ProfileRow[];
  const update = db.prepare('UPDATE discovered_profiles SET affinity = ?, reasons = ? WHERE id = ?');
  for (const r of rows) {
    const data = json<PublicSummary | null>(r.data, null);
    const { score, reasons } = computeAffinity(
      {
        watch: Boolean(r.watch),
        mentionCount: r.mention_count,
        hashtags: json<string[]>(r.hashtags, []),
        topHashtags: data?.topHashtags ?? [],
        lastPostAt: data?.lastPostAt ?? null,
        postsPerWeek: r.posts_per_week,
      },
      own,
      now,
    );
    update.run(score, JSON.stringify(reasons), r.id);
  }
}

// ---------- Leitura ----------

function toDto(r: ProfileRow) {
  const data = json<PublicSummary | null>(r.data, null);
  return {
    id: r.id,
    username: r.username,
    profileUrl: `https://www.instagram.com/${r.username}/`,
    source: r.source,
    watch: Boolean(r.watch),
    mentionCount: r.mention_count,
    hashtags: json<string[]>(r.hashtags, []),
    available: r.available == null ? null : Boolean(r.available),
    error: r.error,
    followers: r.followers,
    avgEngagement: r.avg_engagement,
    postsPerWeek: r.posts_per_week,
    niche: r.niche,
    affinity: r.affinity,
    reasons: json<string[]>(r.reasons, []),
    status: r.status,
    notes: r.notes,
    fetchedAt: r.fetched_at,
    public: data,
  };
}
export type DiscoveredProfile = ReturnType<typeof toDto>;

export function listProfiles(
  db: DatabaseSync,
  accountId: string,
  filter: { statuses?: DiscoveryStatus[]; usernames?: string[]; watch?: boolean } = {},
): DiscoveredProfile[] {
  const rows = db
    .prepare('SELECT * FROM discovered_profiles WHERE account_id = ? ORDER BY affinity DESC, followers DESC')
    .all(accountId) as unknown as ProfileRow[];
  return rows
    .filter(
      (r) =>
        (!filter.statuses || filter.statuses.includes(r.status) || (filter.watch && r.watch)) &&
        (!filter.usernames || filter.usernames.includes(r.username)),
    )
    .map(toDto);
}

// ---------- Casos de uso ----------

export async function searchHashtag(
  db: DatabaseSync,
  client: DiscoveryClient,
  conn: DiscoveryConn | null,
  accountId: string,
  term: string,
  now = Date.now(),
) {
  const hashtag = normalizeTerm(term);
  if (!hashtag || /^\d+$/.test(hashtag)) throw new DiscoveryError(400, 'Digite um termo com pelo menos uma letra.');

  type CacheRow = { hashtag_id: string | null; top_media: string; recent_media: string; fetched_at: number; expires_at: number };
  const cache = db.prepare('SELECT * FROM hashtag_cache WHERE hashtag = ?').get(hashtag) as CacheRow | undefined;
  let top: HashtagMedia[];
  let recent: HashtagMedia[];
  let fetchedAt: number;
  const cached = Boolean(cache && cache.expires_at > now);

  if (cache && cached) {
    top = json(cache.top_media, []);
    recent = json(cache.recent_media, []);
    fetchedAt = cache.fetched_at;
  } else {
    if (!conn) throw new DiscoveryError(409, 'Conecte o Facebook nesta página para buscar por hashtag.');
    const usage = hashtagUsage(db, conn.viaAccountId, now);
    if (usage.used >= HASHTAG_LIMIT && !usage.hashtags.some((h) => h.hashtag === hashtag)) {
      const next = new Date(usage.hashtags[0].freesAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
      throw new DiscoveryError(429, `Limite de ${HASHTAG_LIMIT} hashtags em 7 dias atingido. A próxima vaga abre em ${next}.`);
    }
    try {
      const id = cache?.hashtag_id ?? (await client.hashtagId(conn.igUserId, conn.token, hashtag));
      [top, recent] = id
        ? await Promise.all([
            client.hashtagMedia(id, 'top_media', conn.igUserId, conn.token),
            client.hashtagMedia(id, 'recent_media', conn.igUserId, conn.token),
          ])
        : [[], []];
      db.prepare('INSERT INTO hashtag_usage(account_id, hashtag, queried_at) VALUES(?, ?, ?)').run(conn.viaAccountId, hashtag, now);
      db.prepare(
        `INSERT INTO hashtag_cache(hashtag, hashtag_id, top_media, recent_media, fetched_at, expires_at) VALUES(?, ?, ?, ?, ?, ?)
         ON CONFLICT(hashtag) DO UPDATE SET hashtag_id = excluded.hashtag_id, top_media = excluded.top_media,
           recent_media = excluded.recent_media, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at`,
      ).run(hashtag, id, JSON.stringify(top), JSON.stringify(recent), now, now + CACHE_TTL);
      fetchedAt = now;
    } catch (e) {
      const code = e instanceof InstagramError ? e.code : undefined;
      if (code === 190) throw new DiscoveryError(401, 'O acesso do Facebook expirou ou foi revogado. Reconecte o Facebook.');
      if (code === 10 || code === 200) {
        throw new DiscoveryError(
          403,
          'A Meta recusou a busca por hashtag. Ela exige o recurso "Instagram Public Content Access", que costuma ' +
            'precisar de Análise do app (App Review). As sugestões e a lista de concorrentes continuam funcionando.',
        );
      }
      throw e;
    }
  }

  db.prepare('INSERT INTO discovery_queries(account_id, term, hashtag, cached, created_at) VALUES(?, ?, ?, ?, ?)').run(
    accountId,
    term.slice(0, 200),
    hashtag,
    cached ? 1 : 0,
    now,
  );

  // Perfis: a Meta não devolve o autor, então usamos as @menções das legendas, das mais citadas para as menos.
  const unique = new Map([...top, ...recent].map((m) => [m.id, m]));
  const mentions = [...countBy([...unique.values()].flatMap((m) => [...new Set(extractMentions(m.caption))]))]
    .filter(([u]) => !OWN_USERNAMES.has(u))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([u]) => u);
  for (const u of mentions) upsertCandidate(db, accountId, u, { source: 'hashtag', hashtag }, now);
  if (conn) await refreshProfiles(db, client, conn, accountId, mentions, now);
  recomputeAffinity(db, accountId, ownHashtagWeights(db, accountId), now);

  const post = (edge: 'top' | 'recent') => (m: HashtagMedia) => ({
    id: m.id,
    edge,
    caption: (m.caption ?? '').slice(0, 300),
    mediaType: m.media_type ?? '',
    permalink: m.permalink ?? '',
    likes: m.like_count ?? null,
    comments: m.comments_count ?? null,
    timestamp: m.timestamp ?? '',
  });
  return {
    hashtag,
    cached,
    fetchedAt,
    posts: [...top.map(post('top')), ...recent.map(post('recent'))],
    profiles: listProfiles(db, accountId, { usernames: mentions }),
    usage: conn ? hashtagUsage(db, conn.viaAccountId, now) : null,
  };
}

export async function suggestions(
  db: DatabaseSync,
  client: DiscoveryClient,
  conn: DiscoveryConn | null,
  accountId: string,
  now = Date.now(),
) {
  const own = ownHashtagWeights(db, accountId);
  for (const [u, n] of ownMentions(db, accountId)) upsertCandidate(db, accountId, u, { source: 'afinidade', mentionCount: n }, now);

  // Prioridade de consulta: concorrentes cadastrados, depois os mais mencionados.
  const candidates = (
    db
      .prepare(
        `SELECT username FROM discovered_profiles WHERE account_id = ? AND status != 'descartado'
         ORDER BY watch DESC, mention_count DESC, affinity DESC`,
      )
      .all(accountId) as { username: string }[]
  ).map((r) => r.username);
  const pendingLookups = conn ? await refreshProfiles(db, client, conn, accountId, candidates, now) : 0;
  recomputeAffinity(db, accountId, own, now);

  return {
    profiles: listProfiles(db, accountId, { statuses: ['novo', 'salvo', 'em_contato'] }),
    ownHashtags: [...own].slice(0, 12).map(([hashtag, weight]) => ({ hashtag, weight: round(weight) })),
    pendingLookups,
  };
}

export async function addToWatchlist(
  db: DatabaseSync,
  client: DiscoveryClient,
  conn: DiscoveryConn | null,
  accountId: string,
  input: string,
  now = Date.now(),
): Promise<DiscoveredProfile> {
  const username = normalizeUsername(input);
  if (!username) throw new DiscoveryError(400, 'Username inválido. Use o @ do perfil ou o link dele.');
  if (OWN_USERNAMES.has(username)) throw new DiscoveryError(400, 'Esta é uma das suas contas.');
  upsertCandidate(db, accountId, username, { source: 'manual', watch: true }, now);
  db.prepare(`UPDATE discovered_profiles SET status = 'salvo', updated_at = ? WHERE account_id = ? AND username = ? AND status = 'novo'`).run(
    now,
    accountId,
    username,
  );
  if (conn) await refreshProfiles(db, client, conn, accountId, [username], now);
  recomputeAffinity(db, accountId, ownHashtagWeights(db, accountId), now);
  return listProfiles(db, accountId, { usernames: [username] })[0];
}

export function updateProfile(
  db: DatabaseSync,
  profileId: number,
  changes: { status?: unknown; notes?: unknown; watch?: unknown },
  now = Date.now(),
): DiscoveredProfile {
  const row = db.prepare('SELECT * FROM discovered_profiles WHERE id = ?').get(profileId) as unknown as ProfileRow | undefined;
  if (!row) throw new DiscoveryError(404, 'Perfil não encontrado.');
  if (changes.status !== undefined && !STATUSES.includes(changes.status as DiscoveryStatus)) {
    throw new DiscoveryError(400, 'Status inválido.');
  }
  db.prepare('UPDATE discovered_profiles SET status = ?, notes = ?, watch = ?, updated_at = ? WHERE id = ?').run(
    (changes.status as DiscoveryStatus | undefined) ?? row.status,
    typeof changes.notes === 'string' ? changes.notes.slice(0, 2000) : row.notes,
    typeof changes.watch === 'boolean' ? (changes.watch ? 1 : 0) : row.watch,
    now,
    profileId,
  );
  return toDto(db.prepare('SELECT * FROM discovered_profiles WHERE id = ?').get(profileId) as unknown as ProfileRow);
}
