// Radar de assuntos: leitura de RSS/Atom, agrupamento da mesma notícia, temperatura, Jev e rotas.
import './helpers.ts';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import express from 'express';

const { openDb, db: appDb } = await import('../src/db.ts');
const { findAccount } = await import('../src/config.ts');
const R = await import('../src/radar.ts');
const g = await import('../src/generate.ts');
const { radarRoutes } = await import('../src/routes-radar.ts');
type Answer = import('../src/jev.ts').Answer;

const conta = findAccount('projetos')!; // fixture com radar (tema "Clube Exemplo")
const NOW = Date.now(); // as rotas usam a hora real: as notícias de teste precisam ser recentes
const ago = (h: number) => new Date(NOW - h * 3_600_000).toUTCString();

const rss = (items: { title: string; link: string; h: number; source?: string; desc?: string }[]) => `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Feed</title>
${items
  .map(
    (i) => `<item><title><![CDATA[${i.title}${i.source ? ` - ${i.source}` : ''}]]></title><link>${i.link}</link>
<pubDate>${ago(i.h)}</pubDate>${i.source ? `<source url="https://x">${i.source}</source>` : ''}
<description>${i.desc ?? '&lt;p&gt;Resumo da not&#237;cia com detalhes suficientes para o leitor.&lt;/p&gt;'}</description></item>`,
  )
  .join('\n')}
</channel></rss>`;

const FEED_A = rss([
  { title: 'Clube Exemplo anuncia contratação do atacante Silva', link: 'https://a.test/1', h: 1, source: 'ge' },
  { title: 'Atacante Silva é anunciado pelo Clube Exemplo até 2028', link: 'https://a.test/2', h: 0.5, source: 'ESPN' },
  { title: 'Silva chega ao Clube Exemplo: contratação do atacante confirmada', link: 'https://a.test/3', h: 0.2, source: 'O Dia' },
  { title: 'Clube Exemplo aprova orçamento com déficit', link: 'https://a.test/4', h: 20, source: 'ge' },
]);
const FEED_GERAL = rss([
  { title: 'Rival vence clássico no sábado', link: 'https://b.test/1', h: 2 },
  { title: 'Exemplense treina com novidade no meio-campo', link: 'https://b.test/2', h: 3 },
]);

describe('leitura das fontes', () => {
  it('RSS com CDATA, entidades e o " - Veículo" do Google Notícias', () => {
    const items = R.parseFeed(FEED_A, 'Google Notícias');
    assert.equal(items.length, 4);
    assert.deepEqual([items[0].title, items[0].source], ['Clube Exemplo anuncia contratação do atacante Silva', 'ge']);
    assert.equal(items[0].summary, 'Resumo da notícia com detalhes suficientes para o leitor.');
    assert.equal(items[0].published, new Date(Date.parse(ago(1))).toISOString());
  });

  it('Atom e item sem fonte usam o nome do feed', () => {
    const atom = `<feed><entry><title>Notícia &amp; nota</title><link href="https://c.test/x"/><updated>2026-10-29T10:00:00Z</updated><summary>Ok</summary></entry></feed>`;
    assert.deepEqual(R.parseFeed(atom, 'Coluna'), [
      { title: 'Notícia & nota', link: 'https://c.test/x', published: '2026-10-29T10:00:00.000Z', summary: 'Ok', source: 'Coluna' },
    ]);
  });

  it('fonte genérica só entra se citar o tema (com ou sem acento)', () => {
    const items = R.parseFeed(FEED_GERAL, 'Geral').filter((i) => R.matchesTopic(i, conta.radar!.keywords));
    assert.deepEqual(items.map((i) => i.title), ['Exemplense treina com novidade no meio-campo']);
  });
});

describe('agrupamento e temperatura', () => {
  const fetcher = async (url: string) => (url.includes('geral') ? FEED_GERAL : FEED_A);

  it('junta a mesma notícia de 3 veículos e marca como quente', async () => {
    const db = openDb(':memory:');
    const r = await R.refreshRadar(db, conta, null, fetcher, NOW);
    assert.deepEqual([r.added, r.read, r.classified], [5, 5, 0]);
    const list = R.clusters(db, conta.radar!, conta.id, NOW);
    assert.equal(list[0].sources, 3);
    assert.equal(list[0].temperature, 'quente');
    assert.deepEqual(list[0].items.map((i) => i.source), ['O Dia', 'ESPN', 'ge'], 'mais recente primeiro');
    assert.equal(list.find((c) => /orçamento/.test(c.title))!.temperature, 'fria');
    assert.equal((await R.refreshRadar(db, conta, null, fetcher, NOW)).added, 0, 'não duplica');
  });

  it('fonte fora do ar não derruba as outras', async () => {
    const db = openDb(':memory:');
    const r = await R.refreshRadar(db, conta, null, async (u) => (u.includes('geral') ? Promise.reject(new Error('HTTP 500')) : FEED_A), NOW);
    assert.deepEqual(r.feeds.map((f) => [f.name, f.ok]), [['Notícias', true], ['Geral', false]]);
    assert.equal(r.added, 4);
  });

  it('o Jev classifica tipo, rumor e relevância; rumor muda o briefing', async () => {
    const db = openDb(':memory:');
    const calls: any[] = [];
    const jev: import('../src/jev.ts').JevClient = {
      async systemOne(state: any) {
        calls.push(state);
        const rumor = /orçamento/.test(state.manchete);
        const a: Record<string, Answer> = {
          tipo: { type: 'choice', choice: rumor ? 'bastidor' : 'ultima_hora', confidence: 0.9, probabilities: {} },
          confirmado: { type: 'noul', noul: rumor ? 0.2 : 0.95 },
          relevancia: { type: 'noul', noul: 0.9 },
        };
        return { model: 't', answers: a };
      },
    };
    const r = await R.refreshRadar(db, conta, jev, fetcher, NOW);
    assert.equal(r.classified, 3);
    assert.equal(calls[0].tema, 'Clube Exemplo');
    const list = R.clusters(db, conta.radar!, conta.id, NOW);
    const silva = list[0];
    assert.deepEqual([silva.kind, silva.kindLabel], ['ultima_hora', 'Última hora']);
    assert.match(R.newsBrief(silva), /fato confirmado[\s\S]*Fonte: O Dia, ESPN/);
    const orc = list.find((c) => /orçamento/.test(c.title))!;
    assert.match(R.newsBrief(orc), /NÃO CONFIRMADO[\s\S]*segundo o ge/);
  });
});

describe('Raio-X', () => {
  it('lê as pautas do Claude e converte o formato', async () => {
    const pautas = await R.suggestPautas(conta, 'Ídolos', async () =>
      'Claro!\n[{"titulo": "Os 5 maiores artilheiros", "formato": "carrossel", "descricao": "lista"}, {"titulo": "O gol do título", "formato": "reels"}, {"titulo": " "}]',
    );
    assert.deepEqual(pautas.map((p) => [p.theme, p.kind]), [
      ['Os 5 maiores artilheiros', 'carousel'],
      ['O gol do título', 'reel'],
    ]);
    await assert.rejects(R.suggestPautas(conta, 'x', async () => 'sem json'), /formato esperado/);
    assert.match(R.historyBrief('Clube Exemplo', 'Ídolos'), /\[CONFERIR\]/);
  });
});

describe('rotas', () => {
  const prompts: string[] = [];
  const gen: import('../src/generate.ts').GenDeps = {
    claude: async (_s, user) => {
      prompts.push(user);
      return JSON.stringify({ titulo: 'Silva é do Clube', legenda: 'Silva chegou! Fonte: O Dia', slides: [], roteiro: '', busca_midia: [] });
    },
    jev: null,
    stock: null,
    cache: async (x) => x,
  };
  const app = express()
    .use(express.json())
    .use('/api', radarRoutes(() => ({ jev: null, fetcher: async (u) => (u.includes('geral') ? FEED_GERAL : FEED_A), gen, claude: async () => '[{"titulo": "Pauta 1", "formato": "post"}]' })));
  const server = app.listen(0);
  let base = '';
  before(async () => {
    await new Promise((ok) => server.once('listening', ok));
    base = `http://localhost:${(server.address() as AddressInfo).port}/api`;
  });
  after(() => server.close());
  const call = (path: string, init: RequestInit = {}) =>
    fetch(base + path, { ...init, headers: { 'Content-Type': 'application/json' } }).then(async (r) => ({ status: r.status, json: r.status === 204 ? null : await r.json() }));

  it('conta sem radar não tem rotas de radar', async () => {
    assert.equal((await call('/accounts/loja/radar')).status, 404);
  });

  it('atualiza, cria post a partir da notícia (com briefing) e liga o rascunho', async () => {
    const ref = await call('/accounts/projetos/radar/refresh', { method: 'POST' });
    assert.equal(ref.json.added >= 4, true);
    const list = await call('/accounts/projetos/radar');
    const hot = list.json.clusters.find((c: any) => c.sources === 3) ?? list.json.clusters[0];
    const job = await call(`/accounts/projetos/radar/${hot.id}/post`, { method: 'POST', body: JSON.stringify({ kind: 'carousel' }) });
    assert.equal(job.status, 202);
    await g.jobFinished(job.json.id);
    assert.match(prompts[0], /Informações e regras deste post[\s\S]*Manchetes das fontes/);
    const after1 = await call('/accounts/projetos/radar');
    const used = after1.json.clusters.find((c: any) => c.id === hot.id);
    assert.equal(used.status, 'usado');
    assert.equal(typeof used.draftId, 'number');
    assert.equal((appDb.prepare('SELECT kind FROM drafts WHERE id = ?').get(used.draftId) as any).kind, 'carousel');

    assert.equal((await call(`/accounts/projetos/radar/${hot.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'ignorado' }) })).status, 204);
    assert.equal((await call('/accounts/projetos/radar')).json.clusters.some((c: any) => c.id === hot.id), false, 'ignorado some da lista');
  });

  it('Raio-X: séries padrão, pautas e geração com regras de conteúdo histórico', async () => {
    const series = await call('/accounts/projetos/radar/series');
    assert.ok(series.json.includes('Ídolos de todas as épocas'));
    const pautas = await call('/accounts/projetos/radar/pautas', { method: 'POST', body: JSON.stringify({ serie: 'Ídolos de todas as épocas' }) });
    assert.deepEqual(pautas.json, [{ theme: 'Pauta 1', kind: 'image', description: '' }]);
    assert.equal((await call('/accounts/projetos/radar/pautas/generate', { method: 'POST', body: JSON.stringify({ items: [] }) })).status, 400);
    const job = await call('/accounts/projetos/radar/pautas/generate', {
      method: 'POST',
      body: JSON.stringify({ serie: 'Ídolos de todas as épocas', items: [{ theme: 'Pauta 1', kind: 'image' }] }),
    });
    await g.jobFinished(job.json.id);
    assert.match(prompts.at(-1)!, /\[CONFERIR\]/);
  });
});
