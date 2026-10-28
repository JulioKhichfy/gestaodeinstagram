import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';
import * as ig from './instagram.ts';

export type PostType = 'image' | 'carousel' | 'reel';

export interface PublishRequest {
  type: PostType;
  caption: string;
  /** Arquivos já enviados para /api/media (nome do arquivo em media/). */
  items: string[];
  coverItem?: string;
  shareToFeed?: boolean;
  /** Trial Reels: mostra primeiro só para não seguidores (bom para testar ganchos). */
  trial?: boolean;
  /** Nome do áudio original do Reels (opcional). */
  audioName?: string;
}

export const CAPTION_MAX = 2200;
export const HASHTAG_MAX = 30;
export const CAROUSEL_MAX = 20; // limite atual da API (doc da Meta, out/2026)

const IMAGE_EXT = new Set(['.jpg', '.jpeg']);
const VIDEO_EXT = new Set(['.mp4', '.mov']);

export const isImage = (file: string) => IMAGE_EXT.has(path.extname(file).toLowerCase());
export const isVideo = (file: string) => VIDEO_EXT.has(path.extname(file).toLowerCase());

const publicUrl = (file: string) => `${config.publicBaseUrl}/media/${encodeURIComponent(file)}`;

function mediaExists(file: string): boolean {
  return path.basename(file) === file && fs.existsSync(path.join(config.mediaDir, file));
}

/** Retorna a mensagem de erro, ou null se o pedido é válido. */
export function validate(req: PublishRequest): string | null {
  if (!['image', 'carousel', 'reel'].includes(req.type)) return 'Tipo de post inválido.';
  const caption = req.caption ?? '';
  if (caption.length > CAPTION_MAX) return `A legenda passa de ${CAPTION_MAX} caracteres.`;
  if ((caption.match(/#[\p{L}\p{N}_]+/gu) ?? []).length > HASHTAG_MAX) return `Máximo de ${HASHTAG_MAX} hashtags.`;
  const items = req.items ?? [];
  if (!items.every(mediaExists)) return 'Alguma mídia não foi encontrada. Envie os arquivos novamente.';

  if (req.type === 'image') {
    if (items.length !== 1 || !isImage(items[0])) return 'Post estático precisa de exatamente 1 imagem JPEG.';
  }
  if (req.type === 'carousel') {
    if (items.length < 2 || items.length > CAROUSEL_MAX) return `Carrossel precisa de 2 a ${CAROUSEL_MAX} itens.`;
    if (!items.every((f) => isImage(f) || isVideo(f))) return 'Carrossel aceita apenas JPEG, MP4 ou MOV.';
  }
  if (req.type === 'reel') {
    if (items.length !== 1 || !isVideo(items[0])) return 'Reels precisa de exatamente 1 vídeo MP4 ou MOV.';
    if (req.coverItem && (!mediaExists(req.coverItem) || !isImage(req.coverItem))) return 'Capa do Reels deve ser JPEG.';
  }
  return null;
}

export async function publish(igUserId: string, token: string, req: PublishRequest) {
  const caption = req.caption ?? '';
  let containerId: string;

  if (req.type === 'image') {
    ({ id: containerId } = await ig.createContainer(igUserId, token, { image_url: publicUrl(req.items[0]), caption }));
    await ig.waitUntilReady(containerId, token);
  } else if (req.type === 'carousel') {
    const children: string[] = [];
    for (const file of req.items) {
      const params: Record<string, string> = isVideo(file)
        ? { media_type: 'VIDEO', video_url: publicUrl(file), is_carousel_item: 'true' }
        : { image_url: publicUrl(file), is_carousel_item: 'true' };
      children.push((await ig.createContainer(igUserId, token, params)).id);
    }
    for (const child of children) await ig.waitUntilReady(child, token);
    ({ id: containerId } = await ig.createContainer(igUserId, token, {
      media_type: 'CAROUSEL',
      children: children.join(','),
      caption,
    }));
    await ig.waitUntilReady(containerId, token);
  } else {
    const params: Record<string, string> = {
      media_type: 'REELS',
      video_url: publicUrl(req.items[0]),
      caption,
      share_to_feed: String(req.shareToFeed ?? true),
    };
    if (req.audioName?.trim()) params.audio_name = req.audioName.trim();
    // MANUAL: você decide no app se o Trial Reels vai para os seguidores.
    if (req.trial) params.trial_params = JSON.stringify({ graduation_strategy: 'MANUAL' });
    if (req.coverItem) params.cover_url = publicUrl(req.coverItem);
    ({ id: containerId } = await ig.createContainer(igUserId, token, params));
    await ig.waitUntilReady(containerId, token);
  }

  const result = await ig.publishContainer(igUserId, token, containerId);

  // O Instagram já copiou a mídia; não precisamos mais dos arquivos locais.
  for (const file of [...req.items, req.coverItem].filter(Boolean) as string[]) {
    fs.rm(path.join(config.mediaDir, file), { force: true }, () => {});
  }
  return result;
}
