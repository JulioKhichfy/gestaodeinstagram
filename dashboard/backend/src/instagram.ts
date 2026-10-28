// Cliente da "Instagram API with Instagram Login" (graph.instagram.com).
// Doc: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login
// Nomes de métricas conferidos na doc da Meta em out/2026.
import { config, redirectUri } from './config.ts';

const graph = (p: string) => `https://graph.instagram.com/${config.graphVersion}/${p}`;

export class InstagramError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
  }
}

// Códigos de limite de uso da Graph API: vale esperar e tentar de novo.
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613]);
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

export async function call<T>(url: string, init?: RequestInit, attempt = 0): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) {
    const e = body.error ?? {};
    const retryable = res.status >= 500 || res.status === 429 || RATE_LIMIT_CODES.has(e.code) || e.is_transient;
    if (retryable && attempt < 3) {
      await sleep(2000 * 2 ** attempt); // 2s, 4s, 8s
      return call<T>(url, init, attempt + 1);
    }
    const detail = e.error_user_msg || e.message || body.error_message || res.statusText;
    throw new InstagramError(`Instagram: ${detail}`, e.code);
  }
  return body as T;
}

const form = (params: Record<string, string>) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(params).toString(),
});

export const withToken = (url: string, token: string) =>
  `${url}${url.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`;

export const INSIGHTS_SCOPE = 'instagram_business_manage_insights';
export const SCOPES = ['instagram_business_basic', 'instagram_business_content_publish', INSIGHTS_SCOPE];

export function authorizeUrl(state: string): string {
  const q = new URLSearchParams({
    client_id: config.igAppId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPES.join(','),
    state,
    // Força a tela de login: com várias contas, o navegador pode estar logado na conta errada.
    force_reauth: 'true',
  });
  return `https://www.instagram.com/oauth/authorize?${q}`;
}

/** Troca o code do OAuth por um token de longa duração (~60 dias). */
export async function exchangeCode(code: string): Promise<{ token: string; expiresIn: number; permissions: string[] }> {
  type ShortToken = { access_token: string; permissions?: string | string[] };
  const short = await call<ShortToken & { data?: ShortToken[] }>(
    'https://api.instagram.com/oauth/access_token',
    form({
      client_id: config.igAppId,
      client_secret: config.igAppSecret,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri(),
      code,
    }),
  );
  const granted = short.data?.[0] ?? short;
  if (!granted.access_token) throw new InstagramError('Instagram não retornou token.');
  const permissions = Array.isArray(granted.permissions)
    ? granted.permissions
    : (granted.permissions ?? '').split(',').filter(Boolean);

  const q = new URLSearchParams({
    grant_type: 'ig_exchange_token',
    client_secret: config.igAppSecret,
    access_token: granted.access_token,
  });
  const long = await call<{ access_token: string; expires_in: number }>(
    `https://graph.instagram.com/access_token?${q}`,
  );
  return { token: long.access_token, expiresIn: long.expires_in, permissions };
}

/** Renova o token de longa duração (só funciona se ele tiver ao menos 24h e não estiver expirado). */
export async function refreshToken(token: string): Promise<{ token: string; expiresIn: number }> {
  const q = new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: token });
  const r = await call<{ access_token: string; expires_in: number }>(
    `https://graph.instagram.com/refresh_access_token?${q}`,
  );
  return { token: r.access_token, expiresIn: r.expires_in };
}

export interface Profile {
  user_id: string;
  username: string;
  name?: string;
  profile_picture_url?: string;
  account_type?: string;
  followers_count?: number;
  follows_count?: number;
  media_count?: number;
}

export function getProfile(token: string): Promise<Profile> {
  const fields = 'user_id,username,name,profile_picture_url,account_type,followers_count,follows_count,media_count';
  return call<Profile>(withToken(`${graph('me')}?fields=${fields}`, token));
}

export interface MediaItem {
  id: string;
  caption?: string;
  media_type: string;
  media_product_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink: string;
  timestamp: string;
  like_count?: number;
  comments_count?: number;
}

const MEDIA_FIELDS =
  'id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count';

export async function getRecentMedia(igUserId: string, token: string, limit = 12): Promise<MediaItem[]> {
  const r = await call<{ data: MediaItem[] }>(
    withToken(`${graph(`${igUserId}/media`)}?fields=${MEDIA_FIELDS}&limit=${limit}`, token),
  );
  return r.data;
}

/** Mídias publicadas a partir de `sinceMs`, paginando (mais recentes primeiro). */
export async function getMediaSince(igUserId: string, token: string, sinceMs: number, max = 500): Promise<MediaItem[]> {
  const out: MediaItem[] = [];
  let url: string | undefined = withToken(`${graph(`${igUserId}/media`)}?fields=${MEDIA_FIELDS}&limit=50`, token);
  while (url && out.length < max) {
    const page: { data: MediaItem[]; paging?: { next?: string } } = await call(url);
    for (const m of page.data) {
      if (Date.parse(m.timestamp) < sinceMs) return out;
      out.push(m);
    }
    url = page.paging?.next;
  }
  return out;
}

export async function getPublishingLimit(igUserId: string, token: string): Promise<{ used: number; total: number }> {
  const r = await call<{ data: { quota_usage: number; config?: { quota_total: number } }[] }>(
    withToken(`${graph(`${igUserId}/content_publishing_limit`)}?fields=quota_usage,config`, token),
  );
  const d = r.data[0];
  return { used: d?.quota_usage ?? 0, total: d?.config?.quota_total ?? 0 };
}

// ---------- Métricas (insights) ----------

type InsightValue = { name: string; values?: { value: number }[]; total_value?: { value: number } };

const insightNumber = (i: InsightValue) => i.total_value?.value ?? i.values?.[0]?.value ?? 0;

export type MediaInsights = Partial<
  Record<
    | 'reach'
    | 'views'
    | 'likes'
    | 'comments'
    | 'saved'
    | 'shares'
    | 'total_interactions'
    | 'profile_visits'
    | 'follows'
    | 'reposts'
    | 'ig_reels_avg_watch_time',
    number
  >
>;

const FEED_METRICS = ['reach', 'views', 'likes', 'comments', 'saved', 'shares', 'total_interactions', 'profile_visits', 'follows'];
const REELS_METRICS = ['reach', 'views', 'likes', 'comments', 'saved', 'shares', 'total_interactions', 'ig_reels_avg_watch_time'];
const SAFE_METRICS = ['reach', 'likes', 'comments', 'saved', 'shares'];

/** Métricas lifetime de uma mídia. Se a Meta recusar algum nome, tenta o conjunto mínimo. */
export async function getMediaInsights(mediaId: string, productType: string | undefined, token: string): Promise<MediaInsights> {
  const preferred = productType === 'REELS' ? REELS_METRICS : FEED_METRICS;
  try {
    return await mediaInsights(mediaId, preferred, token);
  } catch (e) {
    if (e instanceof InstagramError && e.code === 190) throw e; // token inválido: não adianta repetir
    return mediaInsights(mediaId, SAFE_METRICS, token);
  }
}

async function mediaInsights(mediaId: string, metrics: string[], token: string): Promise<MediaInsights> {
  const r = await call<{ data: InsightValue[] }>(
    withToken(`${graph(`${mediaId}/insights`)}?metric=${metrics.join(',')}`, token),
  );
  return Object.fromEntries(r.data.map((i) => [i.name, insightNumber(i)]));
}

export const ACCOUNT_DAY_METRICS = [
  'reach',
  'views',
  'accounts_engaged',
  'total_interactions',
  'likes',
  'comments',
  'saves',
  'shares',
  'profile_links_taps',
] as const;
export type AccountDay = Partial<Record<(typeof ACCOUNT_DAY_METRICS)[number], number>>;

/** Totais da conta num intervalo (since/until em segundos Unix). */
export async function getAccountTotals(igUserId: string, token: string, since: number, until: number): Promise<AccountDay> {
  const q = new URLSearchParams({
    metric: ACCOUNT_DAY_METRICS.join(','),
    period: 'day',
    metric_type: 'total_value',
    since: String(since),
    until: String(until),
  });
  const r = await call<{ data: InsightValue[] }>(withToken(`${graph(`${igUserId}/insights`)}?${q}`, token));
  return Object.fromEntries(r.data.map((i) => [i.name, insightNumber(i)]));
}

/** breakdown (age, gender, city, country) -> chave -> valor */
export type Demographics = Record<string, Record<string, number>>;

/** Demografia. A Meta só retorna com 100+ seguidores/engajamentos. */
export async function getDemographics(
  igUserId: string,
  token: string,
  metric: 'follower_demographics' | 'engaged_audience_demographics',
): Promise<Demographics> {
  const out: Demographics = {};
  for (const breakdown of ['age', 'gender', 'city', 'country']) {
    const q = new URLSearchParams({
      metric,
      period: 'lifetime',
      metric_type: 'total_value',
      timeframe: 'this_month',
      breakdown,
    });
    type Results = { results?: { dimension_values: string[]; value: number }[] };
    const r = await call<{ data: { total_value?: { breakdowns?: Results[] } }[] }>(
      withToken(`${graph(`${igUserId}/insights`)}?${q}`, token),
    );
    const results = r.data[0]?.total_value?.breakdowns?.[0]?.results ?? [];
    out[breakdown] = Object.fromEntries(results.map((x) => [x.dimension_values.join(' '), x.value]));
  }
  return out;
}

/** Média de seguidores online por hora (índice 0-23, fuso da Meta) nos dias disponíveis. */
export async function getOnlineFollowers(igUserId: string, token: string): Promise<number[]> {
  const q = new URLSearchParams({ metric: 'online_followers', period: 'lifetime' });
  const r = await call<{ data: { values: { value: Record<string, number> }[] }[] }>(
    withToken(`${graph(`${igUserId}/insights`)}?${q}`, token),
  );
  const days = (r.data[0]?.values ?? []).map((v) => v.value).filter((v) => v && Object.keys(v).length);
  const hours = Array.from({ length: 24 }, () => 0);
  if (!days.length) return hours;
  for (const day of days) for (const [h, n] of Object.entries(day)) hours[Number(h)] += n;
  return hours.map((n) => Math.round(n / days.length));
}

// ---------- Publicação ----------

export function createContainer(igUserId: string, token: string, params: Record<string, string>): Promise<{ id: string }> {
  return call<{ id: string }>(graph(`${igUserId}/media`), form({ ...params, access_token: token }));
}

export async function waitUntilReady(containerId: string, token: string, timeoutMs = 10 * 60 * 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await call<{ status_code: string; status?: string }>(
      withToken(`${graph(containerId)}?fields=status_code,status`, token),
    );
    if (r.status_code === 'FINISHED' || r.status_code === 'PUBLISHED') return;
    if (r.status_code === 'ERROR' || r.status_code === 'EXPIRED') {
      throw new InstagramError(`Instagram não conseguiu processar a mídia (${r.status ?? r.status_code}).`);
    }
    await sleep(5000);
  }
  throw new InstagramError('Tempo esgotado esperando o Instagram processar a mídia.');
}

export async function publishContainer(igUserId: string, token: string, creationId: string): Promise<{ id: string; permalink?: string }> {
  const { id } = await call<{ id: string }>(
    graph(`${igUserId}/media_publish`),
    form({ creation_id: creationId, access_token: token }),
  );
  const media = await call<{ permalink?: string }>(withToken(`${graph(id)}?fields=permalink`, token)).catch(() => ({
    permalink: undefined,
  }));
  return { id, permalink: media.permalink };
}
