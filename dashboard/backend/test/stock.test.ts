// Banco de imagens (Pixabay e Pexels): conversão das respostas e cópia local, sem chamar as APIs.
import './helpers.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const s = await import('../src/stock.ts');

describe('Pexels', () => {
  it('foto: corte 4:5 para o feed, descrição e crédito', () => {
    const p = s.mapPhoto({
      id: 7,
      url: 'https://www.pexels.com/photo/sala-aconchegante-7/',
      alt: 'Sofá cinza com mantas',
      photographer: 'Ana',
      photographer_url: 'https://www.pexels.com/@ana',
      src: { original: 'https://images.pexels.com/photos/7/a.jpeg', medium: 'https://images.pexels.com/photos/7/a.jpeg?h=350' },
    });
    assert.equal(p.id, 'p7');
    assert.equal(p.download, 'https://images.pexels.com/photos/7/a.jpeg?auto=compress&cs=tinysrgb&fit=crop&w=1080&h=1350');
    assert.equal(p.description, 'Sofá cinza com mantas');
    assert.ok(s.STOCK_HOSTS.has(new URL(p.download).hostname));
  });

  it('vídeo: MP4 vertical perto de 1080 de largura, duração boa para Reels', () => {
    const base = {
      id: 9,
      url: 'https://www.pexels.com/video/mulher-arrumando-a-mesa-9/',
      image: 'https://images.pexels.com/videos/9/x.jpg',
      user: { name: 'Bia', url: 'https://www.pexels.com/@bia' },
      video_files: [
        { quality: 'uhd', file_type: 'video/mp4', width: 2160, height: 3840, link: 'https://videos.pexels.com/4k.mp4' },
        { quality: 'hd', file_type: 'video/mp4', width: 1080, height: 1920, link: 'https://videos.pexels.com/hd.mp4' },
        { quality: 'sd', file_type: 'video/mp4', width: 540, height: 960, link: 'https://videos.pexels.com/sd.mp4' },
        { quality: 'hd', file_type: 'video/mp4', width: 1920, height: 1080, link: 'https://videos.pexels.com/deitado.mp4' },
      ],
    };
    const v = s.mapVideo({ ...base, duration: 12 })!;
    assert.equal(v.download, 'https://videos.pexels.com/hd.mp4');
    assert.equal(v.description, 'mulher arrumando a mesa');
    assert.equal(s.mapVideo({ ...base, duration: 2 }), null, 'curto demais para Reels');
    assert.equal(s.mapVideo({ ...base, duration: 300 }), null, 'longo demais para um Reels de banco');
  });

  it('sem chave não busca', async () => {
    await assert.rejects(s.searchStock('photo', ['x']), /PIXABAY_API_KEY/);
  });
});

describe('Pixabay', () => {
  const video = (id: number, w: number, h: number, duration = 15) => ({
    id,
    pageURL: `https://pixabay.com/videos/x-${id}/`,
    tags: 'coffee, rain, window',
    duration,
    user: 'Joao Silva',
    user_id: 42,
    videos: {
      large: { url: `https://cdn.pixabay.com/video/${id}/large.mp4`, width: w * 2, height: h * 2, size: 90_000_000 },
      medium: { url: `https://cdn.pixabay.com/video/${id}/medium.mp4`, width: w, height: h, size: 20_000_000, thumbnail: 'https://cdn.pixabay.com/t-m.jpg' },
      small: { url: '', width: 0, height: 0, size: 0 },
      tiny: { url: `https://cdn.pixabay.com/video/${id}/tiny.mp4`, width: w / 2, height: h / 2, size: 3_000_000, thumbnail: 'https://cdn.pixabay.com/t.jpg' },
    },
  });

  it('foto: tags como descrição e crédito com link do autor', () => {
    const p = s.mapPixabayImage({
      id: 5,
      pageURL: 'https://pixabay.com/photos/x-5/',
      tags: 'sofa, living room',
      previewURL: 'https://cdn.pixabay.com/p.jpg',
      largeImageURL: 'https://pixabay.com/get/abc.jpg',
      user: 'Ana Lima',
      user_id: 9,
    });
    assert.deepEqual([p.id, p.provider, p.description], ['pbp5', 'pixabay', 'sofa, living room']);
    assert.equal(p.creditUrl, 'https://pixabay.com/users/Ana%20Lima-9/');
  });

  it('vídeo: arquivo perto de 1080, marca se é vertical, ignora vazios e longos', () => {
    const v = s.mapPixabayVideo(video(1, 1080, 1920))!;
    assert.equal(v.download, 'https://cdn.pixabay.com/video/1/medium.mp4');
    assert.equal(v.vertical, true);
    assert.equal(v.thumb, 'https://cdn.pixabay.com/t.jpg');
    assert.equal(s.mapPixabayVideo(video(2, 1920, 1080))!.vertical, false);
    assert.equal(s.mapPixabayVideo(video(3, 1080, 1920, 200)), null);
    assert.ok(s.STOCK_HOSTS.has('cdn.pixabay.com'));
  });

  it('copia as fotos do Pixabay para o PC e mantém o resto pelo link', async () => {
    const realFetch = globalThis.fetch;
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    globalThis.fetch = (async (url: string) =>
      /falha/.test(String(url))
        ? new Response('x', { status: 404 })
        : new Response(jpeg, { status: 200, headers: { 'Content-Type': 'image/jpeg' } })) as typeof fetch;
    try {
      const base = { provider: 'pixabay' as const, kind: 'photo' as const, description: '', thumb: '', pageUrl: '', credit: '', creditUrl: '' };
      const out = await s.cacheStock([
        { ...base, id: 'pbp1', download: 'https://pixabay.com/get/ok.jpg' },
        { ...base, id: 'pbp2', download: 'https://pixabay.com/get/falha.jpg' },
        { ...base, id: 'pbv3', kind: 'video', download: 'https://cdn.pixabay.com/video/3.mp4' },
      ]);
      assert.deepEqual(out.map((i) => [i.id, i.download]), [
        ['pbp1', '/media/stock/pbp1.jpg'],
        ['pbv3', 'https://cdn.pixabay.com/video/3.mp4'],
      ]);
      assert.deepEqual(fs.readFileSync(path.join(s.stockDir(), 'pbp1.jpg')), jpeg);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
