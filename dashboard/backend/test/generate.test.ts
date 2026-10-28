// Gerador de posts: Claude escreve, Jev avalia e guia a reescrita, Pexels sugere mídia ranqueada pelo Jev.
import './helpers.ts';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

const { openDb } = await import('../src/db.ts');
const { findAccount } = await import('../src/config.ts');
const g = await import('../src/generate.ts');
type Answer = import('../src/jev.ts').Answer;
type GenDeps = import('../src/generate.ts').GenDeps;
type StockItem = import('../src/stock.ts').StockItem;

const loja = findAccount('loja')!;

const written = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ titulo: 'Kit aconchego', legenda: 'Legenda fraca', slides: [], roteiro: '', busca_midia: ['cozy living room'], ...extra });

/** Dublê do Jev: legenda com "MELHOR" tira nota alta; mídia com "sofa" é a mais relevante. */
function fakeJev() {
  const calls: string[] = [];
  const client: import('../src/jev.ts').JevClient = {
    async systemOne(state: any, questions) {
      calls.push(Object.keys(questions).join(','));
      const good = /MELHOR/.test(state.legenda ?? '');
      const score = (s: number): Answer => ({ type: 'score', score: s, confidence: 0.9, legend: {}, probabilities: {} });
      const answers: Record<string, Answer> = {
        gancho: score(good ? 3 : 0),
        clareza: score(good ? 3 : 1),
        tom: score(good ? 2 : 0),
        cta: { type: 'noul', noul: good ? 0.95 : 0.1 },
        risco: { type: 'noul', noul: 0.05 },
        objetivo: { type: 'choice', choice: 'salvamento', confidence: 0.9, probabilities: {} },
        gancho_tipo: { type: 'choice', choice: 'Pergunta', confidence: 0.8, probabilities: {} },
        estilo: { type: 'choice', choice: 'Educativo', confidence: 0.3, probabilities: {} },
      };
      for (const id of Object.keys(questions)) {
        if (/^[pv]\d/.test(id)) answers[id] = { type: 'noul', noul: /sofa/.test((questions[id] as any).instructions) ? 0.9 : 0.2 };
      }
      return { model: 'jev-test', answers: Object.fromEntries(Object.keys(questions).map((k) => [k, answers[k]])) };
    },
  };
  return { client, calls };
}

const photo = (n: number, desc: string): StockItem => ({
  id: `p${n}`,
  provider: 'pexels',
  kind: 'photo',
  description: desc,
  thumb: `https://images.pexels.com/${n}-thumb.jpg`,
  download: `https://images.pexels.com/${n}.jpeg`,
  pageUrl: `https://www.pexels.com/photo/${n}/`,
  credit: `Autor ${n}`,
  creditUrl: `https://www.pexels.com/@a${n}`,
});

function deps(over: Partial<GenDeps> = {}) {
  const prompts: string[] = [];
  const jev = fakeJev();
  const d: GenDeps = {
    claude: async (_system, user) => {
      prompts.push(user);
      if (/Reescreva a legenda/.test(user)) return '```\nLegenda MELHOR com chamada para ação\n```';
      if (/carrossel/.test(user)) return 'Claro! ' + written({ slides: ['Capa', 'Dica 1', 'Dica 2', 'CTA'] });
      if (/QUEBRA/.test(user)) return 'não é json';
      return written();
    },
    jev: jev.client,
    stock: async () => [photo(1, 'kitchen table'), photo(2, 'gray sofa with pillows'), photo(3, 'street at night')],
    cache: async (items) => items.map((m) => ({ ...m, download: `/media/stock/${m.id}.jpg` })),
    ...over,
  };
  return { d, prompts, jevCalls: jev.calls };
}

const run = async (db: any, items: { theme: string; kind: any }[], d: GenDeps, opts = { rewrite: true, media: true }) => {
  const job = g.startGeneration(db, loja, items, opts, d);
  await g.jobFinished(job.id);
  return job;
};

describe('texto', () => {
  it('lê o JSON do Claude mesmo com texto em volta', () => {
    const w = g.parseWritten('Aqui está:\n```json\n' + written({ slides: ['a', ' ', 'b'] }) + '\n```', 'tema');
    assert.deepEqual([w.title, w.caption, w.slides, w.searchTerms], ['Kit aconchego', 'Legenda fraca', ['a', 'b'], ['cozy living room']]);
    assert.throws(() => g.parseWritten('sem json', 't'), /formato esperado/);
    assert.throws(() => g.parseWritten('{"legenda": ""}', 't'), /sem legenda/);
    assert.deepEqual(g.parseWritten('{"legenda": "x"}', 'meu tema').searchTerms, ['meu tema']);
  });

  it('limpa aspas e bloco de código da reescrita', () => {
    assert.equal(g.cleanCaption('"Texto"'), 'Texto');
    assert.equal(g.cleanCaption('```\nTexto\n```'), 'Texto');
  });
});

describe('geração', () => {
  it('reescreve com as dicas do Jev, fica com a melhor versão e cria o rascunho', async () => {
    const db = openDb(':memory:');
    const { d, prompts } = deps();
    const job = await run(db, [{ theme: 'Kit de inverno', kind: 'carousel' }], d);
    const item = job.items[0];
    assert.equal(item.step, 'pronto', item.error);
    assert.equal(item.grades.length, 2);
    assert.ok(item.grades[1] > item.grades[0] && item.grades[1] >= g.TARGET_GRADE, String(item.grades));
    assert.match(prompts[1], /Reescreva a legenda[\s\S]*nota \d+\/100[\s\S]*Fortaleça a 1ª linha[\s\S]*Legenda fraca/, 'as dicas do Jev vão para o Claude');

    const draft = db.prepare('SELECT * FROM drafts WHERE id = ?').get(item.draftId) as any;
    assert.equal(draft.body, 'Legenda MELHOR com chamada para ação');
    assert.equal(draft.kind, 'carousel');
    assert.equal(draft.status, 'pronto');
    assert.equal(draft.jev_grade, item.grades[1]);
    assert.equal(draft.hook, 'Pergunta');
    assert.equal(draft.style, null, 'estilo com confiança baixa não é gravado');
    assert.match(draft.notes, /Textos dos slides:\n1\. Capa/);
    const media = JSON.parse(draft.media);
    assert.equal(media[0].id, 'p2', 'o Jev põe a mídia mais relevante primeiro');
    assert.equal(media[0].download, '/media/stock/p2.jpg', 'usa a cópia local');
    assert.match(draft.notes, /Mídia: Pexels \(Autor 2/);
    assert.equal(media.filter((m: any) => m.selected).length, 3, 'carrossel: até 1 foto por slide entre as encontradas');
  });

  it('não reescreve quando a reescrita está desligada', async () => {
    const db = openDb(':memory:');
    const { d, prompts } = deps();
    const job = await run(db, [{ theme: 'Tema', kind: 'image' }], d, { rewrite: false, media: false });
    assert.equal(job.items[0].grades.length, 1);
    assert.equal(prompts.length, 1);
    const draft = db.prepare('SELECT status, media FROM drafts').get() as any;
    assert.deepEqual([draft.status, draft.media], ['produzindo', '[]'], 'nota abaixo da meta fica "produzindo"');
  });

  it('sem Jev e sem Pexels ainda gera o texto, com aviso', async () => {
    const db = openDb(':memory:');
    const { d } = deps({ jev: null, stock: null });
    const job = await run(db, [{ theme: 'Tema', kind: 'reel' }], d);
    assert.equal(job.items[0].step, 'pronto');
    assert.match(job.items[0].notes[0], /PIXABAY_API_KEY/);
    assert.equal((db.prepare('SELECT status FROM drafts').get() as any).status, 'pronto');
  });

  it('Reels: prefere vídeo vertical e avisa quando só há horizontal', async () => {
    const video = (n: number, vertical: boolean): StockItem => ({ ...photo(n, 'sofa'), id: `v${n}`, kind: 'video', vertical });
    const db = openDb(':memory:');
    const { d } = deps({ stock: async () => [video(1, false), video(2, true)] });
    const job = await run(db, [{ theme: 'Tema', kind: 'reel' }], d, { rewrite: false, media: true });
    const media = JSON.parse((db.prepare('SELECT media FROM drafts').get() as any).media);
    assert.deepEqual([media[0].id, media[0].selected], ['v2', true]);
    assert.deepEqual(job.items[0].notes, []);

    const db2 = openDb(':memory:');
    const job2 = await run(db2, [{ theme: 'Tema', kind: 'reel' }], deps({ stock: async () => [video(3, false)] }).d, { rewrite: false, media: true });
    assert.match(job2.items[0].notes[0], /horizontais/);
  });

  it('um post com erro não impede os outros', async () => {
    const db = openDb(':memory:');
    const { d } = deps();
    const job = await run(db, [{ theme: 'QUEBRA', kind: 'image' }, { theme: 'Bom', kind: 'image' }], d, { rewrite: false, media: false });
    assert.deepEqual(job.items.map((i) => i.step), ['erro', 'pronto']);
    assert.match(job.items[0].error!, /formato esperado/);
    assert.equal(job.done, true);
  });
});

const { app } = await import('../src/server.ts');
const { db: appDb } = await import('../src/db.ts');

describe('rotas', () => {
  let base = '';
  let token = '';
  const server = app.listen(0);
  before(async () => {
    await new Promise((ok) => server.once('listening', ok));
    base = `http://localhost:${(server.address() as AddressInfo).port}/api`;
    token = (await (await fetch(`${base}/session/setup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'senha-de-teste' }) })).json()).token;
  });
  after(() => server.close());
  const api = (path: string, init: RequestInit = {}) =>
    fetch(base + path, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } });

  it('valida o pedido e exige sessão', async () => {
    assert.equal((await fetch(`${base}/generate/status`)).status, 401);
    const st = await (await api('/generate/status')).json();
    assert.deepEqual([st.jev, st.stock, st.maxItems, st.target], [false, false, 10, 75]);
    assert.equal((await api('/accounts/loja/generate', { method: 'POST', body: JSON.stringify({ items: [{ theme: ' ' }] }) })).status, 400);
    const many = Array.from({ length: 11 }, () => ({ theme: 'x' }));
    assert.equal((await api('/accounts/loja/generate', { method: 'POST', body: JSON.stringify({ items: many }) })).status, 400);
    assert.equal((await api('/accounts/xyz/generate', { method: 'POST', body: JSON.stringify({ items: [{ theme: 'x' }] }) })).status, 404);
    assert.equal((await api('/generate/nao-existe')).status, 404);
  });

  it('só baixa mídia do Pexels', async () => {
    for (const url of ['https://evil.example.com/a.jpg', 'http://images.pexels.com/a.jpg', 'file:///etc/passwd', 'nada']) {
      assert.equal((await api(`/stock/file?url=${encodeURIComponent(url)}`)).status, 400, url);
    }
  });

  it('troca a mídia escolhida do rascunho', async () => {
    const db = appDb;
    const media = [photo(1, 'a'), photo(2, 'b')].map((m, i) => ({ ...m, selected: i === 0 }));
    const id = Number(
      db.prepare(`INSERT INTO drafts(account_id, title, kind, status, media, created_at, updated_at) VALUES('loja', 'x', 'image', 'ideia', ?, 0, 0)`)
        .run(JSON.stringify(media)).lastInsertRowid,
    );
    const r = await (await api(`/drafts/${id}/media`, { method: 'PUT', body: JSON.stringify({ selected: ['p2', 'p999'] }) })).json();
    assert.deepEqual(r.map((m: any) => m.selected), [false, true]);
    const list = await (await api('/accounts/loja/drafts')).json();
    assert.equal(list.find((d: any) => d.id === id).media[1].selected, true, 'a lista devolve a mídia já como array');
  });
});
