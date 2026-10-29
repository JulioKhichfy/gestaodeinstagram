// Busca em vários bancos de imagens ao mesmo tempo (Unsplash + Pixabay), com a API simulada.
import './helpers.ts';
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

process.env.UNSPLASH_ACCESS_KEY = 'chave-unsplash';
process.env.PIXABAY_API_KEY = 'chave-pixabay';

const realFetch = globalThis.fetch;
const calls: { url: string; auth?: string }[] = [];
let unsplashStatus = 200;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  calls.push({ url, auth: (init?.headers as Record<string, string> | undefined)?.Authorization });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  if (url.startsWith('https://api.unsplash.com/search/photos')) {
    return json(
      {
        results: [
          {
            id: 'abc',
            alt_description: 'cozy sofa with blanket',
            urls: { raw: 'https://images.unsplash.com/photo-1?ixid=XYZ', small: 'https://images.unsplash.com/photo-1?w=400' },
            links: { html: 'https://unsplash.com/photos/abc', download_location: 'https://api.unsplash.com/photos/abc/download?ixid=XYZ' },
            user: { name: 'Lia', links: { html: 'https://unsplash.com/@lia' } },
          },
        ],
      },
      unsplashStatus,
    );
  }
  if (url.startsWith('https://pixabay.com/api/')) {
    return json({ hits: [{ id: 9, pageURL: 'https://pixabay.com/p-9/', tags: 'sofa', previewURL: 'https://cdn.pixabay.com/p.jpg', largeImageURL: 'https://pixabay.com/get/9.jpg', user: 'Rui', user_id: 1 }] });
  }
  return new Response('', { status: 204 });
}) as typeof fetch;
after(() => {
  globalThis.fetch = realFetch;
});

const s = await import('../src/stock.ts');

describe('vários bancos de imagens', () => {
  it('busca fotos no Unsplash e no Pixabay e junta os resultados', async () => {
    calls.length = 0;
    const items = await s.searchStock('photo', ['cozy sofa']);
    assert.deepEqual(items.map((i) => i.id), ['usabc', 'pbp9']);
    assert.equal(calls.find((c) => c.url.includes('unsplash'))!.auth, 'Client-ID chave-unsplash');
    const u = items[0];
    assert.equal(u.download, 'https://images.unsplash.com/photo-1?ixid=XYZ&fm=jpg&fit=crop&crop=entropy&w=1080&h=1350&q=85', 'mantém o ixid e corta em 4:5');
    assert.match(u.creditUrl, /utm_source=gestao_instagram&utm_medium=referral/);
    assert.equal(u.track, 'https://api.unsplash.com/photos/abc/download?ixid=XYZ');
    assert.ok(s.STOCK_HOSTS.has(new URL(u.download).hostname));
  });

  it('vídeo não consulta o Unsplash (não tem vídeo)', async () => {
    calls.length = 0;
    await s.searchStock('video', ['rain']);
    assert.ok(calls.every((c) => !c.url.includes('unsplash')));
  });

  it('um banco com erro não derruba os outros', async () => {
    unsplashStatus = 401;
    try {
      const items = await s.searchStock('photo', ['a', 'b']);
      assert.deepEqual(items.map((i) => i.id), ['pbp9']);
      assert.equal(calls.filter((c) => c.url.includes('unsplash')).length >= 1, true);
    } finally {
      unsplashStatus = 200;
    }
  });

  it('aviso de download: só a API do Unsplash, com a chave', async () => {
    assert.equal(s.isUnsplashTrack('https://api.unsplash.com/photos/abc/download?ixid=1'), true);
    for (const bad of ['https://evil.com/photos/abc/download', 'http://api.unsplash.com/photos/abc/download', 'https://api.unsplash.com/me', 'x']) {
      assert.equal(s.isUnsplashTrack(bad), false, bad);
    }
    calls.length = 0;
    await s.trackUnsplash('https://api.unsplash.com/photos/abc/download?ixid=1');
    await s.trackUnsplash('https://evil.com/photos/abc/download');
    assert.deepEqual(calls.map((c) => [c.url, c.auth]), [['https://api.unsplash.com/photos/abc/download?ixid=1', 'Client-ID chave-unsplash']]);
  });
});
