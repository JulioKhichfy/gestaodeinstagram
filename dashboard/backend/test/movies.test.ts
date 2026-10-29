// Central de Filmes: menus como roteiro, títulos planejados pelo Claude, textos sem spoiler, Story e limites.
import './helpers.ts';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import express from 'express';

const M = await import('../src/movies.ts');
const g = await import('../src/generate.ts');
const { db: appDb, openDb } = await import('../src/db.ts');
const { findAccount } = await import('../src/config.ts');
const { movieRoutes, parseRows } = await import('../src/routes-movies.ts');

const rssOf = (titles: string[], hoursAgo = 2) =>
  `<rss><channel>${titles
    .map((t, i) => `<item><title>${t} - ge</title><link>https://n.test/${i}</link><pubDate>${new Date(Date.now() - hoursAgo * 3_600_000).toUTCString()}</pubDate><source url="x">ge</source></item>`)
    .join('')}</channel></rss>`;

describe('catálogo', () => {
  it('os 5 menus com as opções das imagens, sem nada vindo do IMDb', () => {
    assert.deepEqual(
      M.MOVIE_HUB.map((g) => [g.label, g.options.length]),
      [
        ['Filmes', 8],
        ['Programas de TV', 5],
        ['Prêmios e eventos', 10],
        ['Celebridades', 3],
        ['Assistir', 7],
      ],
    );
    for (const o of M.MOVIE_HUB.flatMap((g) => g.options)) assert.doesNotMatch(o.query ?? '', /imdb/i);
    assert.ok(M.findOption('filmes', 'bilheteria')?.option.query);
    assert.equal(M.findOption('filmes', 'xyz'), null);
  });
});

describe('planejamento e regras do texto', () => {
  it('manchetes recentes do Google Notícias (antigas ficam de fora)', async () => {
    let asked = '';
    const fresh = await M.headlines('bilheteria', async (u) => ((asked = u), rssOf(['Filme A lidera bilheteria'])));
    assert.deepEqual(fresh, ['Filme A lidera bilheteria (ge)']);
    assert.match(asked, /q=bilheteria\+when%3A14d&hl=pt-BR/);
    assert.deepEqual(await M.headlines('x', async () => rssOf(['Velha'], 24 * 30)), []);
    assert.deepEqual(await M.headlines('x', async () => Promise.reject(new Error('fora'))), []);
  });

  it('pedido ao Claude leva manchetes, data, indicação e o que não repetir', () => {
    const { group, option } = M.findOption('filmes', 'genero')!;
    const p = M.planPrompt(group, option, { group: 'filmes', option: 'genero', kind: 'carousel', qty: 3, extra: 'suspense' }, ['Manchete X (ge)'], ['Seven (1995)'], '29 de outubro de 2026');
    assert.match(p, /Escolha 3 assunto/);
    assert.match(p, /Filmes › Pesquisar filmes por gênero/);
    assert.match(p, /Indicação de quem pediu: suspense/);
    assert.match(p, /- Manchete X \(ge\)/);
    assert.match(p, /Não repita: Seven \(1995\)/);
    assert.deepEqual(M.parsePlan('ok [{"titulo": "Zodíaco (2007)", "angulo": "obsessão", "fonte": ""}, {"titulo": ""}]', 5), [
      { title: 'Zodíaco (2007)', angle: 'obsessão', source: '' },
    ]);
    assert.throws(() => M.parsePlan('nada', 3), /formato esperado/);
  });

  it('briefing: sem spoiler, [CONFERIR] e fonte quando é notícia', () => {
    const { group, option } = M.findOption('filmes', 'noticias-filmes')!;
    const b = M.movieBrief(group, option, { title: 'Filme Y', angle: 'novo trailer', source: 'Omelete' }, ['Filme Y ganha trailer (Omelete)']);
    assert.match(b, /SEM SPOILERS/);
    assert.match(b, /\[CONFERIR\]/);
    assert.match(b, /Fonte: Omelete/);
  });

  it('valida as linhas da tela', () => {
    assert.throws(() => parseRows({ rows: [] }), /quantidade/);
    assert.throws(() => parseRows({ rows: [{ group: 'filmes', option: 'nao', kind: 'image', qty: 1 }] }), /Opção inválida/);
    assert.throws(() => parseRows({ rows: [{ group: 'filmes', option: 'top-filmes', kind: 'tiktok', qty: 1 }] }), /Formato inválido/);
    assert.throws(() => parseRows({ rows: [{ group: 'filmes', option: 'top-filmes', kind: 'image', qty: 21 }] }), /No máximo 20/);
    assert.equal(parseRows({ rows: [{ group: 'filmes', option: 'top-filmes', kind: 'story', qty: 2 }, { group: 'tv', option: 'top-series', kind: 'reel', qty: 0 }] }).length, 1);
  });
});

describe('Story e limite de caracteres', () => {
  const conta = findAccount('cursos')!;
  const written = (legenda: string, slides: string[] = []) => JSON.stringify({ titulo: 'T', legenda, slides, roteiro: 'Enquete: já viu?', busca_midia: [] });

  it('Story pede telas curtas e figurinha', () => {
    const p = g.writePrompt('Duna', 'story');
    assert.match(p, /Story \(sequência de 1 a 3 telas/);
    assert.match(p, /até 120 caracteres cada/);
    assert.match(p, /figurinha interativa/);
  });

  it('texto acima do limite: o Claude encurta antes da revisão', async () => {
    const db = openDb(':memory:');
    const prompts: string[] = [];
    const deps: import('../src/generate.ts').GenDeps = {
      claude: async (_s, user) => {
        prompts.push(user);
        return /Encurte/.test(user) ? 'Versão curta do story!' : written('x'.repeat(400), ['Tela 1 curta', 'y'.repeat(130)]);
      },
      jev: null,
      stock: null,
      cache: async (x) => x,
    };
    const job = g.startGeneration(db, conta, [{ theme: 'Duna', kind: 'story' }], { rewrite: false, media: false }, deps);
    await g.jobFinished(job.id);
    const d = db.prepare('SELECT kind, body, notes FROM drafts').get() as any;
    assert.deepEqual([d.kind, d.body], ['story', 'Versão curta do story!']);
    assert.match(prompts[1], /no máximo 300 caracteres/);
    assert.match(d.notes, /passa de 120 caracteres/);
  });
});

describe('rotas', () => {
  const prompts: string[] = [];
  const claude = async (_s: string, user: string) => {
    prompts.push(user);
    if (/Escolha \d+ assunto/.test(user)) {
      const n = Number(user.match(/Escolha (\d+)/)![1]);
      const news = /› Bilheteria de sucesso/.test(user);
      const base = news ? 'Filme Bilheteria' : 'Clássico';
      return JSON.stringify(Array.from({ length: n }, (_, i) => ({ titulo: `${base} ${i + 1}`, angulo: 'ângulo', fonte: news ? 'ge' : '' })));
    }
    return JSON.stringify({ titulo: 'Post', legenda: 'Legenda sem spoiler', slides: [], roteiro: '', busca_midia: [] });
  };
  const deps = () => ({
    claude,
    fetcher: async () => rssOf(['Filme Bilheteria 1 lidera o fim de semana']),
    gen: { claude, jev: null, stock: null, cache: async (x: any) => x } as import('../src/generate.ts').GenDeps,
  });
  const app = express().use(express.json()).use('/api', movieRoutes(deps));
  const server = app.listen(0);
  let base = '';
  before(async () => {
    await new Promise((ok) => server.once('listening', ok));
    base = `http://localhost:${(server.address() as AddressInfo).port}/api`;
  });
  after(() => server.close());
  const call = (path: string, body?: unknown) =>
    fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({
      status: r.status,
      json: await r.json(),
    }));

  it('só contas com a Central de Filmes', async () => {
    assert.equal((await call('/accounts/loja/filmes/catalogo')).status, 404);
    const cat = await call('/accounts/cursos/filmes/catalogo');
    assert.equal(cat.json.groups.length, 5);
    assert.equal(cat.json.groups[0].options.find((o: any) => o.id === 'bilheteria').current, true);
  });

  it('planeja títulos por linha, sem repetir, e gera os rascunhos no formato pedido', async () => {
    const r = await call('/accounts/cursos/filmes/gerar', {
      rows: [
        { group: 'filmes', option: 'bilheteria', kind: 'image', qty: 1 },
        { group: 'filmes', option: 'top-filmes', kind: 'story', qty: 2 },
      ],
    });
    assert.equal(r.status, 202);
    assert.equal(r.json.phase, 'planejando');
    await g.jobFinished(r.json.id);
    const job = g.getJob(r.json.id)!;
    assert.equal(job.error, undefined);
    assert.deepEqual(job.items.map((i) => [i.theme, i.kind, i.step]), [
      ['Filme Bilheteria 1', 'image', 'pronto'],
      ['Clássico 1', 'story', 'pronto'],
      ['Clássico 2', 'story', 'pronto'],
    ]);
    const plan2 = prompts.find((p) => /250 filmes mais bem avaliados/.test(p))!;
    assert.match(plan2, /Não repita: Filme Bilheteria 1/);
    const write1 = prompts.find((p) => /Tema: Filme Bilheteria 1/.test(p))!;
    assert.match(write1, /Manchetes recentes[\s\S]*SEM SPOILERS[\s\S]*Fonte: ge/);
    const kinds = appDb.prepare(`SELECT kind, media FROM drafts WHERE account_id = 'cursos' ORDER BY id`).all() as any[];
    assert.deepEqual(kinds.map((k) => k.kind), ['image', 'story', 'story']);
    assert.ok(kinds.every((k) => k.media === '[]'), 'sem imagens: só texto');
  });

  it('planejamento com erro aparece no trabalho', async () => {
    const bad = movieRoutes(() => ({ ...deps(), claude: async () => 'sem json' }));
    const srv = express().use(express.json()).use('/api', bad).listen(0);
    await new Promise((ok) => srv.once('listening', ok));
    const url = `http://localhost:${(srv.address() as AddressInfo).port}/api/accounts/cursos/filmes/gerar`;
    const job = await (await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows: [{ group: 'assistir', option: 'familia', kind: 'carousel', qty: 1 }] }) })).json();
    await g.jobFinished(job.id);
    assert.match(g.getJob(job.id)!.error!, /formato esperado/);
    srv.close();
  });
});
