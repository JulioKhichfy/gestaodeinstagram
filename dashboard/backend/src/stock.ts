// Fotos e vídeos de banco de imagens gratuito para ilustrar posts gerados. Todos com licença que permite uso
// comercial e API oficial (nada de buscar imagens soltas na internet: direito autoral). A busca usa todos os
// provedores configurados e o Jev escolhe as melhores entre todas.
//   Unsplash (UNSPLASH_ACCESS_KEY): https://unsplash.com/documentation (conferida em out/2026). Fotos de alta
//     qualidade, sem vídeo. Exige usar os links do Unsplash (sem cópia), avisar o download (download_location)
//     e dar crédito ao fotógrafo e ao Unsplash. Modo demo: 50 pedidos/hora.
//   Pixabay (PIXABAY_API_KEY): https://pixabay.com/api/docs/ (conferida em out/2026). Proíbe usar os links das fotos
//     de forma permanente: as fotos sugeridas são baixadas para media/stock no momento da geração. Vídeos podem ser
//     usados pelo link. Pede para mostrar a origem. 100 pedidos/60 s.
//   Pexels (PEXELS_API_KEY): https://www.pexels.com/api/documentation/ (out/2026: novas chaves pausadas). Pede crédito.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';

export type StockProvider = 'unsplash' | 'pixabay' | 'pexels';
export const PROVIDER_LABELS: Record<StockProvider, string> = { unsplash: 'Unsplash', pixabay: 'Pixabay', pexels: 'Pexels' };
export const PROVIDER_SITES: Record<StockProvider, string> = {
  unsplash: 'https://unsplash.com/?utm_source=gestao_instagram&utm_medium=referral',
  pixabay: 'https://pixabay.com',
  pexels: 'https://www.pexels.com',
};

export interface StockItem {
  /** Único entre provedores: 'pbp123'/'pbv123' (Pixabay), 'p123'/'v123' (Pexels). */
  id: string;
  provider: StockProvider;
  kind: 'photo' | 'video';
  /** Descrição usada para o Jev julgar se combina com o tema. */
  description: string;
  thumb: string;
  /** Arquivo para o post: URL do provedor ou cópia local em /media/stock/. */
  download: string;
  pageUrl: string;
  credit: string;
  creditUrl: string;
  duration?: number;
  /** Vídeo vertical (bom para Reels); horizontais aparecem com faixas. */
  vertical?: boolean;
  /** Unsplash: endereço que precisa ser avisado quando a foto é baixada para um post. */
  track?: string;
  /** Probabilidade (0 a 1), dada pelo Jev, de a mídia combinar com o tema. */
  relevance?: number;
  selected?: boolean;
}

/** Provedores com chave no .env, do que tem fotos melhores para o mais genérico. */
export const stockProviders = (): StockProvider[] =>
  (['unsplash', 'pexels', 'pixabay'] as const).filter((p) =>
    p === 'unsplash' ? config.unsplashAccessKey : p === 'pexels' ? config.pexelsApiKey : config.pixabayApiKey,
  );
export const stockConfigured = () => stockProviders().length > 0;

/** Hosts de onde o backend aceita baixar mídia para o editor (evita virar proxy aberto). */
export const STOCK_HOSTS = new Set(['images.unsplash.com', 'images.pexels.com', 'videos.pexels.com', 'pixabay.com', 'cdn.pixabay.com']);

/** Fotos copiadas para o PC ficam em media/stock e são servidas em /media/stock/. */
export const stockDir = () => path.join(config.mediaDir, 'stock');

export class StockError extends Error {}

const MIN_REELS_SECONDS = 3;
/** Vídeos de banco mais longos que isso raramente servem para Reels. */
const MAX_REELS_SECONDS = 90;
const MAX_PHOTO_BYTES = 15 * 1024 * 1024;

async function getJson<T>(url: string, init: RequestInit, provider: string, keyVar: string): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  if (res.status === 401 || res.status === 403 || (res.status === 400 && /key/i.test(await res.clone().text())))
    throw new StockError(`${provider} recusou a chave: confira ${keyVar} no backend/.env.`);
  if (res.status === 429) throw new StockError(`Limite de buscas do ${provider} atingido. Tente de novo em alguns minutos.`);
  if (!res.ok) throw new StockError(`${provider}: erro ${res.status}.`);
  return (await res.json()) as T;
}

/** "https://www.pexels.com/video/mulher-caminhando-na-praia-123/" -> "mulher caminhando na praia" */
export const slugText = (url: string) =>
  decodeURIComponent(url.replace(/\/+$/, '').split('/').pop() ?? '')
    .replace(/-?\d+$/, '')
    .replace(/-/g, ' ')
    .trim();

/** Escolhe o arquivo cujo lado menor fica mais perto de 1080 (bom para Reels sem arquivo gigante). */
function closestTo1080<T extends { width: number; height: number }>(files: T[]): T | undefined {
  return [...files].sort((a, b) => Math.abs(Math.min(a.width, a.height) - 1080) - Math.abs(Math.min(b.width, b.height) - 1080))[0];
}

const reelsDuration = (s: number) => s >= MIN_REELS_SECONDS && s <= MAX_REELS_SECONDS;

// ---------- Unsplash ----------

interface UnsplashPhoto {
  id: string;
  description?: string | null;
  alt_description?: string | null;
  urls: { raw: string; small: string };
  links: { html: string; download_location: string };
  user: { name: string; links: { html: string } };
}

const utm = (url: string) => `${url}${url.includes('?') ? '&' : '?'}utm_source=gestao_instagram&utm_medium=referral`;

export function mapUnsplash(p: UnsplashPhoto): StockItem {
  return {
    id: `us${p.id}`,
    provider: 'unsplash',
    kind: 'photo',
    description: (p.alt_description || p.description || '').trim(),
    thumb: p.urls.small,
    // O raw aceita parâmetros de recorte; mantém o ixid que já vem nele. 1080x1350 = 4:5 do feed.
    download: `${p.urls.raw}${p.urls.raw.includes('?') ? '&' : '?'}fm=jpg&fit=crop&crop=entropy&w=1080&h=1350&q=85`,
    pageUrl: utm(p.links.html),
    credit: p.user.name,
    creditUrl: utm(p.user.links.html),
    track: p.links.download_location,
  };
}

async function searchUnsplash(query: string, perPage: number): Promise<StockItem[]> {
  const params = new URLSearchParams({ query, orientation: 'portrait', per_page: String(perPage), content_filter: 'high' });
  const r = await getJson<{ results: UnsplashPhoto[] }>(
    `https://api.unsplash.com/search/photos?${params}`,
    { headers: { Authorization: `Client-ID ${config.unsplashAccessKey}`, 'Accept-Version': 'v1' } },
    'Unsplash',
    'UNSPLASH_ACCESS_KEY',
  );
  return r.results.map(mapUnsplash);
}

/** Endereços de aviso de download aceitos (só a API do Unsplash). */
export const isUnsplashTrack = (url: string) => {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === 'api.unsplash.com' && /^\/photos\/[\w-]+\/download$/.test(u.pathname);
  } catch {
    return false;
  }
};

/** O Unsplash pede um aviso cada vez que uma foto é baixada para uso (só contagem; não devolve a foto). */
export async function trackUnsplash(url: string): Promise<void> {
  if (!config.unsplashAccessKey || !isUnsplashTrack(url)) return;
  await fetch(url, { headers: { Authorization: `Client-ID ${config.unsplashAccessKey}` }, signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
}

// ---------- Pixabay ----------

interface PixabayImage {
  id: number;
  pageURL: string;
  tags: string;
  previewURL: string;
  largeImageURL: string;
  user: string;
  user_id: number;
}

interface PixabayVideoFile {
  url: string;
  width: number;
  height: number;
  size: number;
  thumbnail?: string;
}

interface PixabayVideo {
  id: number;
  pageURL: string;
  tags: string;
  duration: number;
  user: string;
  user_id: number;
  videos: Record<'large' | 'medium' | 'small' | 'tiny', PixabayVideoFile>;
}

const pixabayUser = (h: { user: string; user_id: number }) => `https://pixabay.com/users/${encodeURIComponent(h.user)}-${h.user_id}/`;

export function mapPixabayImage(h: PixabayImage): StockItem {
  return {
    id: `pbp${h.id}`,
    provider: 'pixabay',
    kind: 'photo',
    description: h.tags,
    thumb: h.previewURL,
    download: h.largeImageURL,
    pageUrl: h.pageURL,
    credit: h.user,
    creditUrl: pixabayUser(h),
  };
}

export function mapPixabayVideo(v: PixabayVideo): StockItem | null {
  const files = Object.values(v.videos ?? {}).filter((f) => f?.url && f.size > 0 && f.size < 150 * 1024 * 1024);
  const file = closestTo1080(files);
  if (!file || !reelsDuration(v.duration)) return null;
  return {
    id: `pbv${v.id}`,
    provider: 'pixabay',
    kind: 'video',
    description: v.tags,
    thumb: v.videos.tiny?.thumbnail || v.videos.small?.thumbnail || file.thumbnail || '',
    download: file.url,
    pageUrl: v.pageURL,
    credit: v.user,
    creditUrl: pixabayUser(v),
    duration: v.duration,
    vertical: file.height > file.width,
  };
}

async function searchPixabay(kind: 'photo' | 'video', query: string, perPage: number): Promise<StockItem[]> {
  const params = new URLSearchParams({ key: config.pixabayApiKey, q: query.slice(0, 100), safesearch: 'true', per_page: String(perPage) });
  if (kind === 'photo') {
    params.set('image_type', 'photo');
    params.set('orientation', 'vertical');
    const r = await getJson<{ hits: PixabayImage[] }>(`https://pixabay.com/api/?${params}`, {}, 'Pixabay', 'PIXABAY_API_KEY');
    return r.hits.map(mapPixabayImage);
  }
  // A busca de vídeos não filtra orientação: pede mais e prefere os verticais depois.
  params.set('per_page', String(Math.max(perPage, 30)));
  const r = await getJson<{ hits: PixabayVideo[] }>(`https://pixabay.com/api/videos/?${params}`, {}, 'Pixabay', 'PIXABAY_API_KEY');
  return r.hits.map(mapPixabayVideo).filter((i): i is StockItem => i !== null);
}

// ---------- Pexels ----------

interface PexelsPhoto {
  id: number;
  url: string;
  alt?: string;
  photographer: string;
  photographer_url: string;
  src: { original: string; medium: string };
}

interface PexelsVideo {
  id: number;
  url: string;
  duration: number;
  image: string;
  user: { name: string; url: string };
  video_files: { quality: string; file_type: string; width: number; height: number; link: string }[];
}

export function mapPhoto(p: PexelsPhoto): StockItem {
  return {
    id: `p${p.id}`,
    provider: 'pexels',
    kind: 'photo',
    description: p.alt?.trim() || slugText(p.url),
    thumb: p.src.medium,
    // Corte 4:5, o formato vertical que o feed aceita (o Instagram recusa fotos mais altas que 4:5).
    download: `${p.src.original}?auto=compress&cs=tinysrgb&fit=crop&w=1080&h=1350`,
    pageUrl: p.url,
    credit: p.photographer,
    creditUrl: p.photographer_url,
  };
}

export function mapVideo(v: PexelsVideo): StockItem | null {
  const file = closestTo1080(v.video_files.filter((f) => f.file_type === 'video/mp4' && f.height > f.width && f.width >= 540 && f.width <= 1440));
  if (!file || !reelsDuration(v.duration)) return null;
  return {
    id: `v${v.id}`,
    provider: 'pexels',
    kind: 'video',
    description: slugText(v.url),
    thumb: v.image,
    download: file.link,
    pageUrl: v.url,
    credit: v.user.name,
    creditUrl: v.user.url,
    duration: v.duration,
    vertical: true,
  };
}

async function searchPexels(kind: 'photo' | 'video', query: string, perPage: number): Promise<StockItem[]> {
  const params = new URLSearchParams({ query, orientation: 'portrait', per_page: String(perPage) });
  const init = { headers: { Authorization: config.pexelsApiKey } };
  if (kind === 'photo') {
    const r = await getJson<{ photos: PexelsPhoto[] }>(`https://api.pexels.com/v1/search?${params}`, init, 'Pexels', 'PEXELS_API_KEY');
    return r.photos.map(mapPhoto);
  }
  const r = await getJson<{ videos: PexelsVideo[] }>(`https://api.pexels.com/v1/videos/search?${params}`, init, 'Pexels', 'PEXELS_API_KEY');
  return r.videos.map(mapVideo).filter((i): i is StockItem => i !== null);
}

// ---------- Busca e cópia local ----------

/**
 * Busca com vários termos em todos os provedores configurados e junta os resultados, sem repetir.
 * Um provedor com erro não derruba os outros. Vídeos verticais vêm primeiro.
 */
export async function searchStock(kind: 'photo' | 'video', queries: string[], perQuery = 8): Promise<StockItem[]> {
  const providers = stockProviders().filter((p) => kind === 'photo' || p !== 'unsplash'); // Unsplash não tem vídeo
  if (!providers.length) {
    throw new StockError(
      kind === 'video'
        ? 'Nenhum banco de vídeos configurado (PIXABAY_API_KEY ou PEXELS_API_KEY).'
        : 'Sem chave de banco de imagens no backend/.env (UNSPLASH_ACCESS_KEY ou PIXABAY_API_KEY): sugestões de foto/vídeo desligadas.',
    );
  }
  const out = new Map<string, StockItem>();
  let lastError: Error | null = null;
  for (const provider of providers) {
    for (const query of queries.slice(0, 3)) {
      try {
        const found =
          provider === 'unsplash'
            ? await searchUnsplash(query, perQuery)
            : provider === 'pixabay'
              ? await searchPixabay(kind, query, perQuery)
              : await searchPexels(kind, query, perQuery);
        for (const item of found) out.set(item.id, item);
      } catch (e) {
        lastError = e as Error;
        break; // chave errada ou limite: não adianta repetir neste provedor
      }
    }
  }
  if (!out.size && lastError) throw lastError;
  const items = [...out.values()];
  return kind === 'video' ? [...items.filter((i) => i.vertical), ...items.filter((i) => !i.vertical)] : items;
}

/**
 * Copia para o PC as fotos que o provedor não deixa usar pelo link (Pixabay). As que falharem saem da lista.
 * Vídeos e fotos do Pexels seguem pelo link.
 */
export async function cacheStock(items: StockItem[]): Promise<StockItem[]> {
  const dir = stockDir();
  fs.mkdirSync(dir, { recursive: true });
  const out: StockItem[] = [];
  for (const item of items) {
    if (item.provider !== 'pixabay' || item.kind !== 'photo') {
      out.push(item);
      continue;
    }
    const file = `${item.id}.jpg`;
    const target = path.join(dir, file);
    try {
      if (!fs.existsSync(target)) {
        const res = await fetch(item.download, { signal: AbortSignal.timeout(30_000) });
        const type = res.headers.get('content-type') ?? '';
        if (!res.ok || !type.startsWith('image/')) continue;
        const data = Buffer.from(await res.arrayBuffer());
        if (data.length > MAX_PHOTO_BYTES) continue;
        fs.writeFileSync(target, data);
      }
      out.push({ ...item, thumb: `/media/stock/${file}`, download: `/media/stock/${file}` });
    } catch {
      // foto indisponível: segue sem ela
    }
  }
  return out;
}
