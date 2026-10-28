// Descoberta: normalização, limite de 30 hashtags, cache, afinidade e garantia de que nada é enviado a perfis.
import './helpers.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const { openDb } = await import('../src/db.ts');
const d = await import('../src/discovery.ts');
const fb = await import('../src/facebook.ts');
const { InstagramError } = await import('../src/instagram.ts');

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-28T12:00:00Z');
const conn = { igUserId: 'IG1', token: 'tok', viaAccountId: 'autora' };

const post = (id: string, caption: string, daysAgo = 1) => ({
  id,
  caption,
  media_type: 'IMAGE',
  permalink: `https://www.instagram.com/p/${id}/`,
  like_count: 40,
  comments_count: 10,
  timestamp: new Date(NOW - daysAgo * DAY).toISOString(),
});

/** Dublê da API que conta as chamadas. */
function fakeClient(opts: { failUser?: string; hashtagError?: number } = {}) {
  const calls = { hashtagId: 0, hashtagMedia: 0, businessDiscovery: 0 };
  const client: import('../src/facebook.ts').DiscoveryClient = {
    async hashtagId() {
      calls.hashtagId++;
      if (opts.hashtagError) throw new InstagramError('Instagram: sem permissão', opts.hashtagError);
      return 'H1';
    },
    async hashtagMedia(_id, edge) {
      calls.hashtagMedia++;
      return edge === 'top_media'
        ? [post('p1', 'Projeto lindo com @Arq.Amiga e @pessoal #decoracaoafetiva'), post('p2', 'Feito por @arq.amiga #casa')]
        : [post('p3', 'Inspiração @studio.luz #decoracaoafetiva')];
    },
    async businessDiscovery(_ig, _t, username) {
      calls.businessDiscovery++;
      if (username === opts.failUser) throw new InstagramError('Instagram: Cannot find user', 110);
      return {
        id: `id-${username}`,
        username,
        name: username.toUpperCase(),
        followers_count: 1000,
        media_count: 120,
        media: { data: [post('a', '#decoracaoafetiva #casa', 2), post('b', '#decoracaoafetiva', 9), post('c', '#luz', 16)] },
      };
    },
  };
  return { client, calls };
}

describe('normalização', () => {
  it('termo vira hashtag: minúsculo, sem acento, sem espaço e sem pontuação', () => {
    assert.equal(d.normalizeTerm('Decoração Afetiva!'), 'decoracaoafetiva');
    assert.equal(d.normalizeTerm('#Arquitetura_Sensorial'), 'arquitetura_sensorial');
    assert.equal(d.normalizeTerm('  Ação  Já  '), 'acaoja');
    assert.equal(d.normalizeTerm('!!!'), '');
  });

  it('username aceita @, link do perfil e recusa inválidos', () => {
    assert.equal(d.normalizeUsername('@Fulano.Arq'), 'fulano.arq');
    assert.equal(d.normalizeUsername('https://www.instagram.com/fulano_x/?hl=pt'), 'fulano_x');
    assert.equal(d.normalizeUsername('nome com espaço'), null);
    assert.equal(d.normalizeUsername(''), null);
  });

  it('extrai menções e hashtags das legendas', () => {
    assert.deepEqual(d.extractMentions('Oi @Maria.Arq. e @joao_1, email a@b.com'), ['maria.arq', 'joao_1']);
    assert.deepEqual(d.extractHashtags('#Decoração e #casa_boa'), ['decoracao', 'casa_boa']);
  });
});

describe('busca por hashtag', () => {
  it('usa o cache por 24h sem gastar outra hashtag do limite', async () => {
    const db = openDb(':memory:');
    const { client, calls } = fakeClient();
    const first = await d.searchHashtag(db, client, conn, 'autora', 'Decoração Afetiva', NOW);
    assert.equal(first.hashtag, 'decoracaoafetiva');
    assert.equal(first.cached, false);
    assert.equal(first.posts.length, 3);
    assert.equal(first.usage?.used, 1);

    const second = await d.searchHashtag(db, client, conn, 'autora', '#decoracaoafetiva', NOW + 60_000);
    assert.equal(second.cached, true);
    assert.equal(calls.hashtagId, 1);
    assert.equal(calls.hashtagMedia, 2);
    assert.equal(second.usage?.used, 1);

    // Depois de 24h busca de novo, mas reaproveita o id da hashtag (é fixo).
    const third = await d.searchHashtag(db, client, conn, 'autora', 'decoracaoafetiva', NOW + DAY + 1);
    assert.equal(third.cached, false);
    assert.equal(calls.hashtagId, 1);
    assert.equal(calls.hashtagMedia, 4);
    assert.equal(third.usage?.used, 1, 'a mesma hashtag não conta duas vezes na janela');
  });

  it('sem conexão do Facebook, só responde o que está em cache', async () => {
    const db = openDb(':memory:');
    const { client } = fakeClient();
    await assert.rejects(d.searchHashtag(db, client, null, 'autora', 'casa', NOW), { status: 409 });
    await d.searchHashtag(db, client, conn, 'autora', 'casa', NOW);
    const cached = await d.searchHashtag(db, client, null, 'autora', 'casa', NOW + 1000);
    assert.equal(cached.cached, true);
    assert.equal(cached.usage, null);
  });

  it('bloqueia a 31ª hashtag em 7 dias e libera quando a janela passa', async () => {
    const db = openDb(':memory:');
    const { client } = fakeClient();
    const ins = db.prepare('INSERT INTO hashtag_usage(account_id, hashtag, queried_at) VALUES(?, ?, ?)');
    for (let i = 0; i < 30; i++) ins.run('autora', `tag${i}`, NOW - 6 * DAY + i);
    assert.equal(d.hashtagUsage(db, 'autora', NOW).remaining, 0);

    await assert.rejects(d.searchHashtag(db, client, conn, 'autora', 'nova', NOW), { status: 429 });
    // Hashtag já contada na janela pode ser consultada de novo.
    const again = await d.searchHashtag(db, client, conn, 'autora', 'tag3', NOW);
    assert.equal(again.usage?.used, 30);
    // Outra conta tem limite próprio.
    const other = await d.searchHashtag(db, client, { ...conn, viaAccountId: 'loja' }, 'loja', 'nova', NOW);
    assert.equal(other.usage?.used, 1);
    // Dois dias depois, as 30 consultas antigas saíram da janela de 7 dias.
    const later = await d.searchHashtag(db, client, conn, 'autora', 'nova', NOW + 2 * DAY);
    assert.equal(later.cached, false);
    assert.equal(later.usage?.used, 2, 'tag3 (consultada hoje) + nova');
  });

  it('extrai perfis das @menções, consulta Business Discovery e marca contas indisponíveis', async () => {
    const db = openDb(':memory:');
    const { client, calls } = fakeClient({ failUser: 'pessoal' });
    const r = await d.searchHashtag(db, client, conn, 'autora', 'decoracaoafetiva', NOW);
    const byName = Object.fromEntries(r.profiles.map((p) => [p.username, p]));
    assert.deepEqual(Object.keys(byName).sort(), ['arq.amiga', 'pessoal', 'studio.luz']);
    assert.equal(calls.businessDiscovery, 3);

    const amiga = byName['arq.amiga'];
    assert.equal(amiga.available, true);
    assert.equal(amiga.followers, 1000);
    assert.equal(amiga.avgEngagement, 5); // (40 + 10) / 1000
    assert.equal(amiga.niche, '#decoracaoafetiva · #casa · #luz');
    assert.equal(amiga.profileUrl, 'https://www.instagram.com/arq.amiga/');
    assert.ok(amiga.reasons.some((x) => x.includes('#decoracaoafetiva')));
    assert.equal(byName.pessoal.available, false);

    // Dentro de 24h não consulta o mesmo perfil de novo.
    await d.searchHashtag(db, client, conn, 'autora', 'decoracaoafetiva', NOW + 1000);
    assert.equal(calls.businessDiscovery, 3);
  });

  it('erro de permissão da Meta vira mensagem clara e não gasta o limite', async () => {
    const db = openDb(':memory:');
    const { client } = fakeClient({ hashtagError: 10 });
    await assert.rejects(d.searchHashtag(db, client, conn, 'autora', 'casa', NOW), (e: any) => e.status === 403 && /App Review/.test(e.message));
    assert.equal(d.hashtagUsage(db, 'autora', NOW).used, 0);
  });

  it('recusa termo sem letras', async () => {
    const db = openDb(':memory:');
    await assert.rejects(d.searchHashtag(db, fakeClient().client, conn, 'autora', '123 !!', NOW), { status: 400 });
  });
});

describe('sugestões, lista e afinidade', () => {
  it('sugere perfis mencionados pela conta, ranqueados por afinidade', async () => {
    const db = openDb(':memory:');
    const ins = db.prepare(
      `INSERT INTO media(id, account_id, media_type, product_type, caption, timestamp, synced_at) VALUES(?, 'autora', 'IMAGE', 'FEED', ?, ?, 0)`,
    );
    ins.run('m1', 'Com @arq.amiga #decoracaoafetiva', new Date(NOW - DAY).toISOString());
    ins.run('m2', 'De novo @arq.amiga e @cursos.exemplo #decoracaoafetiva', new Date(NOW - 2 * DAY).toISOString());
    ins.run('m3', 'Visita ao @outro.perfil', new Date(NOW - 3 * DAY).toISOString());

    const s = await d.suggestions(db, fakeClient().client, conn, 'autora', NOW);
    assert.deepEqual(s.profiles.map((p) => p.username), ['arq.amiga', 'outro.perfil'], 'as 4 contas do dashboard ficam de fora');
    assert.equal(s.profiles[0].mentionCount, 2);
    assert.ok(s.profiles[0].affinity > s.profiles[1].affinity);
    assert.equal(s.ownHashtags[0].hashtag, 'decoracaoafetiva');
  });

  it('sem Facebook, sugere sem consultar dados públicos', async () => {
    const db = openDb(':memory:');
    db.prepare(
      `INSERT INTO media(id, account_id, media_type, caption, timestamp, synced_at) VALUES('m1', 'loja', 'IMAGE', 'Oi @loja.vizinha', ?, 0)`,
    ).run(new Date(NOW).toISOString());
    const { client, calls } = fakeClient();
    const s = await d.suggestions(db, client, null, 'loja', NOW);
    assert.equal(s.profiles[0].username, 'loja.vizinha');
    assert.equal(s.profiles[0].available, null);
    assert.equal(calls.businessDiscovery, 0);
  });

  it('watchlist salva concorrente, muda status e valida entrada', async () => {
    const db = openDb(':memory:');
    const p = await d.addToWatchlist(db, fakeClient().client, conn, 'projetos', 'https://instagram.com/Concorrente.X/', NOW);
    assert.equal(p.username, 'concorrente.x');
    assert.equal(p.status, 'salvo');
    assert.equal(p.watch, true);
    assert.ok(p.reasons.includes('Cadastrado por você como concorrente ou referência'));

    await assert.rejects(d.addToWatchlist(db, fakeClient().client, conn, 'projetos', 'nome inválido', NOW), { status: 400 });
    await assert.rejects(d.addToWatchlist(db, fakeClient().client, conn, 'projetos', '@projetos.exemplo', NOW), { status: 400 });

    assert.equal(d.updateProfile(db, p.id, { status: 'em_contato', notes: 'Mandei DM pelo app' }).status, 'em_contato');
    assert.throws(() => d.updateProfile(db, p.id, { status: 'seguir' }), { status: 400 });
    assert.throws(() => d.updateProfile(db, 9999, {}), { status: 404 });

    d.updateProfile(db, p.id, { status: 'descartado', watch: false });
    assert.equal(d.listProfiles(db, 'projetos', { statuses: ['salvo', 'em_contato'], watch: true }).length, 0);
  });

  it('afinidade explica cada ponto', () => {
    const own = new Map([['casa', 10], ['luz', 5]]);
    const r = d.computeAffinity(
      { watch: true, mentionCount: 1, hashtags: ['casa'], topHashtags: ['casa', 'luz', 'outra'], lastPostAt: new Date(NOW - DAY).toISOString(), postsPerWeek: 2 },
      own,
      NOW,
    );
    // hashtags 15 + 7,5 · menção 10 · busca 8 · watchlist 15 · ativo 5
    assert.equal(r.score, 61);
    assert.equal(r.reasons.length, 5);
    assert.equal(d.computeAffinity({ watch: false, mentionCount: 0, hashtags: [], topHashtags: [], lastPostAt: null, postsPerWeek: null }, own, NOW).score, 0);
  });
});

describe('nenhum contato automático', () => {
  const FORBIDDEN_PATH = /\/(messages|conversations|follow|unfollow|follows|subscribed_apps|comments|replies|media_publish)\b/i;

  it('o código da Descoberta não chama follow, unfollow, DM nem escreve na API', () => {
    for (const file of ['facebook.ts', 'discovery.ts', 'routes-discovery.ts']) {
      const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', file), 'utf8');
      const code = src.replace(/^\s*\/\/.*$/gm, ''); // ignora comentários
      assert.doesNotMatch(code, /['"`]\/?[^'"`]*\/(messages|conversations|follow|unfollow)\b/i, file);
      assert.doesNotMatch(code, /method:\s*['"](POST|PUT|DELETE)['"]/i, file);
      assert.doesNotMatch(code, /\bform\(/, file);
    }
  });

  it('em execução, toda chamada à Meta é GET de leitura', async () => {
    const requests: { method: string; url: URL }[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      requests.push({ method: init?.method ?? 'GET', url });
      const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (url.pathname.endsWith('/ig_hashtag_search')) return ok({ data: [{ id: 'H9' }] });
      if (/\/H9\/(top|recent)_media$/.test(url.pathname)) return ok({ data: [post('x1', 'Veja @perfil.um #tema')] });
      const username = /username\(([^)]+)\)/.exec(url.searchParams.get('fields') ?? '')?.[1] ?? 'x';
      return ok({ business_discovery: { id: 'B1', username, followers_count: 10, media: { data: [] } } });
    }) as typeof fetch;
    try {
      const db = openDb(':memory:');
      db.prepare(`INSERT INTO media(id, account_id, media_type, caption, timestamp, synced_at) VALUES('m', 'cursos', 'IMAGE', 'com @perfil.dois', ?, 0)`).run(
        new Date(NOW).toISOString(),
      );
      const c = { igUserId: 'IG1', token: 'tok', viaAccountId: 'cursos' };
      await d.searchHashtag(db, fb.discoveryClient, c, 'cursos', 'tema', NOW);
      await d.suggestions(db, fb.discoveryClient, c, 'cursos', NOW);
      await d.addToWatchlist(db, fb.discoveryClient, c, 'cursos', '@perfil.tres', NOW);
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.ok(requests.length >= 5);
    for (const r of requests) {
      assert.equal(r.method, 'GET', r.url.pathname);
      assert.equal(r.url.host, 'graph.facebook.com');
      assert.doesNotMatch(r.url.pathname, FORBIDDEN_PATH);
    }
  });
});
