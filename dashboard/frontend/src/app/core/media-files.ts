// Regras de mídia do Instagram aplicadas no navegador, antes do upload.

/** Proporções aceitas no feed: de 4:5 (retrato) a 1.91:1 (paisagem). */
export const FEED_RATIO_MIN = 4 / 5;
export const FEED_RATIO_MAX = 1.91;

export const CAPTION_MAX = 2200;
export const HASHTAG_MAX = 30;
/** Limite da API desde 2025 (doc da Meta, conferido em out/2026). */
export const CAROUSEL_MAX = 20;
/** Acima disso só avisamos: há relatos de limite de 5 desde dez/2025, mas as fontes conflitam. */
export const HASHTAG_SOFT = 5;

export interface LocalMedia {
  key: string;
  kind: 'image' | 'video';
  file: File;
  previewUrl: string;
  width: number;
  height: number;
  /** Segundos (só vídeo). */
  duration?: number;
  warning?: string;
}

const isJpeg = (f: File) => f.type === 'image/jpeg' || /\.jpe?g$/i.test(f.name);
export const isVideoFile = (f: File) => /^video\//.test(f.type) || /\.(mp4|mov)$/i.test(f.name);

/** A API só aceita JPEG: converte PNG/WebP/etc. no navegador. */
async function toJpeg(file: File, bitmap: ImageBitmap): Promise<File> {
  if (isJpeg(file)) return file;
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff'; // PNG transparente vira fundo branco
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0);
  const blob = await canvasToJpeg(canvas);
  return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
}

export function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((ok, fail) =>
    canvas.toBlob((b) => (b ? ok(b) : fail(new Error('Falha ao gerar JPEG'))), 'image/jpeg', 0.92),
  );
}

function ratioWarning(w: number, h: number): string | undefined {
  const r = w / h;
  if (r < FEED_RATIO_MIN - 0.01) return 'Mais alta que 4:5 — o Instagram pode recusar ou cortar.';
  if (r > FEED_RATIO_MAX + 0.01) return 'Mais larga que 1.91:1 — o Instagram pode recusar ou cortar.';
  return undefined;
}

/** Recorte central que coloca a imagem dentro das proporções do feed (null = já está dentro). */
export function feedCrop(w: number, h: number): { x: number; y: number; width: number; height: number } | null {
  const r = w / h;
  if (r < FEED_RATIO_MIN) {
    const height = Math.round(w / FEED_RATIO_MIN);
    return { x: 0, y: Math.round((h - height) / 2), width: w, height };
  }
  if (r > FEED_RATIO_MAX) {
    const width = Math.round(h * FEED_RATIO_MAX);
    return { x: Math.round((w - width) / 2), y: 0, width, height: h };
  }
  return null;
}

/** Foto de banco de imagens: corta pelo centro para 4:5 (ou 1.91:1) quando sai do que o feed aceita. */
export async function cropToFeed(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const crop = feedCrop(bitmap.width, bitmap.height);
  if (!crop) {
    bitmap.close();
    return file;
  }
  const canvas = document.createElement('canvas');
  canvas.width = crop.width;
  canvas.height = crop.height;
  canvas.getContext('2d')!.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
  bitmap.close();
  const blob = await canvasToJpeg(canvas);
  return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
}

export async function loadImage(file: File): Promise<LocalMedia> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`Não consegui abrir "${file.name}". Use JPEG ou PNG (HEIC do iPhone não abre no navegador).`);
  }
  const jpeg = await toJpeg(file, bitmap);
  const media: LocalMedia = {
    key: crypto.randomUUID(),
    kind: 'image',
    file: jpeg,
    previewUrl: URL.createObjectURL(jpeg),
    width: bitmap.width,
    height: bitmap.height,
    warning: ratioWarning(bitmap.width, bitmap.height),
  };
  bitmap.close();
  return media;
}

export function loadVideo(file: File): Promise<LocalMedia> {
  if (!/\.(mp4|mov)$/i.test(file.name)) {
    return Promise.reject(new Error(`"${file.name}": vídeo precisa ser MP4 ou MOV.`));
  }
  return new Promise((ok, fail) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () =>
      ok({
        key: crypto.randomUUID(),
        kind: 'video',
        file,
        previewUrl: url,
        width: video.videoWidth,
        height: video.videoHeight,
        duration: video.duration,
      });
    video.onerror = () => fail(new Error(`Não consegui ler o vídeo "${file.name}".`));
    video.src = url;
  });
}

export function release(media: LocalMedia): void {
  URL.revokeObjectURL(media.previewUrl);
}

export function countHashtags(text: string): number {
  return (text.match(/#[\p{L}\p{N}_]+/gu) ?? []).length;
}
