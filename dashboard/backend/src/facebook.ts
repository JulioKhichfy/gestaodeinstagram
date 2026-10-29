// Cliente da "Instagram API with Facebook Login" (graph.facebook.com), usado SÓ pela Descoberta.
// Busca por hashtag e Business Discovery não existem na API com login do Instagram.
// Docs conferidas em out/2026:
//   https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-hashtag-search
//   https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-hashtag/recent-media
//   https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/business_discovery
// Depois do OAuth, este módulo só faz leitura (GET). Não existe follow, unfollow nem DM aqui, de propósito.
import { config, fbRedirectUri } from './config.ts';
import { call, withToken } from './instagram.ts';

const graph = (p: string) => `https://graph.facebook.com/${config.graphVersion}/${p}`;

/**
 * Permissões pedidas no login do Facebook. Servem à Descoberta e também à conexão das contas por este login
 * (sincronizar e publicar via graph.facebook.com). business_management cobre Páginas do Gerenciador de Negócios.
 */
export const FB_SCOPES = [
  'instagram_basic',
  'instagram_manage_insights',
  'instagram_content_publish',
  'instagram_manage_comments',
  'pages_show_list',
  'pages_read_engagement',
  'business_management',
];

function get<T>(path: string, params: Record<string, string>, token: string): Promise<T> {
  return call<T>(withToken(`${graph(path)}?${new URLSearchParams(params)}`, token));
}

export function fbAuthorizeUrl(state: string): string {
  const q = new URLSearchParams({
    client_id: config.fbAppId,
    redirect_uri: fbRedirectUri(),
    response_type: 'code',
    state,
  });
  // Apps do tipo Empresa usam o "Login do Facebook para Empresas": as permissões ficam numa configuração
  // criada no painel da Meta (config_id). Sem ela, pede as permissões direto (scope).
  if (config.fbConfigId) q.set('config_id', config.fbConfigId);
  else q.set('scope', FB_SCOPES.join(','));
  return `https://www.facebook.com/${config.graphVersion}/dialog/oauth?${q}`;
}

/** Troca o code por um token de usuário de longa duração (~60 dias; não renova sem novo login). */
export async function fbExchangeCode(code: string): Promise<{ token: string; expiresIn: number }> {
  const app = { client_id: config.fbAppId, client_secret: config.fbAppSecret };
  const short = await call<{ access_token: string }>(
    `${graph('oauth/access_token')}?${new URLSearchParams({ ...app, redirect_uri: fbRedirectUri(), code })}`,
  );
  const long = await call<{ access_token: string; expires_in?: number }>(
    `${graph('oauth/access_token')}?${new URLSearchParams({ ...app, grant_type: 'fb_exchange_token', fb_exchange_token: short.access_token })}`,
  );
  return { token: long.access_token, expiresIn: long.expires_in ?? 60 * 24 * 60 * 60 };
}

export async function fbMe(token: string): Promise<{ name: string; permissions: string[] }> {
  const [me, perms] = await Promise.all([
    get<{ name?: string }>('me', { fields: 'name' }, token),
    get<{ data: { permission: string; status: string }[] }>('me/permissions', {}, token),
  ]);
  return {
    name: me.name ?? '',
    permissions: perms.data.filter((p) => p.status === 'granted').map((p) => p.permission),
  };
}

/**
 * Contas do Instagram vinculadas às Páginas do Facebook que o usuário administra, e as Páginas sem Instagram
 * (para explicar quando nada aparece: ligar pela Central de Contas não vincula a conta à Página).
 */
export async function fbLinkedInstagram(
  token: string,
): Promise<{ accounts: { igUserId: string; username: string }[]; pagesWithoutInstagram: string[] }> {
  type Page = { name?: string; instagram_business_account?: { id: string; username?: string } };
  const res = await get<{ data: Page[] }>('me/accounts', { fields: 'name,instagram_business_account{id,username}', limit: '100' }, token);
  return {
    accounts: res.data
      .map((p) => p.instagram_business_account)
      .filter((a): a is { id: string; username: string } => Boolean(a?.username))
      .map((a) => ({ igUserId: a.id, username: a.username })),
    pagesWithoutInstagram: res.data.filter((p) => !p.instagram_business_account).map((p) => p.name ?? '(sem nome)'),
  };
}

export interface HashtagMedia {
  id: string;
  caption?: string;
  media_type?: string;
  permalink?: string;
  like_count?: number;
  comments_count?: number;
  timestamp?: string;
}

export async function hashtagId(igUserId: string, token: string, hashtag: string): Promise<string | null> {
  const res = await get<{ data: { id: string }[] }>('ig_hashtag_search', { user_id: igUserId, q: hashtag }, token);
  return res.data[0]?.id ?? null;
}

/** top_media ou recent_media (últimas 24h). A Meta não devolve o username do autor. */
export async function hashtagMedia(
  tagId: string,
  edge: 'top_media' | 'recent_media',
  igUserId: string,
  token: string,
): Promise<HashtagMedia[]> {
  const res = await get<{ data: HashtagMedia[] }>(
    `${tagId}/${edge}`,
    { user_id: igUserId, fields: 'id,caption,media_type,permalink,like_count,comments_count,timestamp', limit: '50' },
    token,
  );
  return res.data;
}

export interface PublicProfile {
  id?: string;
  username: string;
  name?: string;
  biography?: string;
  website?: string;
  profile_picture_url?: string;
  followers_count?: number;
  follows_count?: number;
  media_count?: number;
  media?: { data: HashtagMedia[] };
}

/** Dados públicos de outra conta profissional, pelo username (Business Discovery). */
export async function businessDiscovery(igUserId: string, token: string, username: string): Promise<PublicProfile> {
  const fields =
    `business_discovery.username(${username}){id,username,name,biography,website,profile_picture_url,` +
    'followers_count,follows_count,media_count,media.limit(25){id,caption,media_type,permalink,like_count,comments_count,timestamp}}';
  const res = await get<{ business_discovery: PublicProfile }>(igUserId, { fields }, token);
  return res.business_discovery;
}

/** O que a Descoberta usa da API; os testes trocam por um dublê. */
export interface DiscoveryClient {
  hashtagId: typeof hashtagId;
  hashtagMedia: typeof hashtagMedia;
  businessDiscovery: typeof businessDiscovery;
}

export const discoveryClient: DiscoveryClient = { hashtagId, hashtagMedia, businessDiscovery };
