// Radar de assuntos: lê fontes de notícia (RSS/Atom) de um tema, junta a mesma notícia publicada por vários veículos
// e mede a "temperatura" (quantas fontes, quão recente). O Jev classifica o tipo e se é fato confirmado ou rumor.
// Só lemos manchetes, resumos e links publicados pelas próprias fontes; o post é escrito pelo Claude com outras
// palavras e com a fonte creditada (nada de copiar texto ou foto de terceiros).
import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { AccountConfig, RadarConfig } from './config.ts';
import type { GenKind } from './generate.ts';
import { getJob } from './generate.ts';
import type { JevClient, Question } from './jev.ts';
import { logCall } from './review.ts';

export interface FeedItem {
  title: string;
  link: string;
  published: string; // ISO
  summary: string;
  source: string;
}

export const RADAR_HOURS = 48;
const KEEP_DAYS = 7;
const CLASSIFY_TOP = 20;
const HOUR = 3_600_000;

export const DEFAULT_SERIES = [
  'Linha do tempo: da fundação aos dias atuais',
  'Ídolos de todas as épocas',
  'Jogos históricos',
  'Gols decisivos e golaços',
  'Títulos e campanhas',
  'Curiosidades e recordes',
  'Frases e entrevistas marcantes',
  'Elenco atual: quem é quem',
];

// ---------- Leitura de RSS/Atom (sem dependências) ----------

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const stripTags = (s: string) => decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  if (!m) return null;
  const raw = m[1].trim();
  const cdata = raw.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return cdata ? cdata[1] : decodeEntities(raw);
}

/** Itens de um feed RSS 2.0 ou Atom. `fallbackSource` = nome da fonte configurada. */
export function parseFeed(xml: string, fallbackSource: string): FeedItem[] {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  const out: FeedItem[] = [];
  for (const b of blocks) {
    let title = stripTags(tag(b, 'title') ?? '');
    const link = (tag(b, 'link') ?? b.match(/<link[^>]*href="([^"]+)"/i)?.[1] ?? '').trim();
    if (!title || !/^https?:\/\//.test(link)) continue;
    const date = tag(b, 'pubDate') ?? tag(b, 'published') ?? tag(b, 'updated') ?? tag(b, 'dc:date');
    const time = date ? Date.parse(date) : NaN;
    const source = stripTags(tag(b, 'source') ?? '') || fallbackSource;
    // Google Notícias põe " - Veículo" no fim do título.
    if (title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3)).trim();
    out.push({
      title,
      link: decodeEntities(link),
      published: Number.isFinite(time) ? new Date(time).toISOString() : new Date().toISOString(),
      summary: stripTags(tag(b, 'description') ?? tag(b, 'summary') ?? tag(b, 'content') ?? '').slice(0, 400),
      source,
    });
  }
  return out;
}

export const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** Fonte genérica (filter: true): só entram itens que citam o tema. */
export const matchesTopic = (item: FeedItem, keywords: string[]) => {
  const text = normalize(`${item.title} ${item.summary}`);
  return keywords.some((k) => text.includes(normalize(k)));
};

async function fetchFeed(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (painel de conteúdo; leitura de RSS)', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// ---------- Guardar e agrupar ----------

const itemId = (link: string) => crypto.createHash('sha1').update(link).digest('hex').slice(0, 20);

export function saveItems(db: DatabaseSync, accountId: string, feed: string, items: FeedItem[], now = Date.now()): number {
  const ins = db.prepare(
    `INSERT OR IGNORE INTO radar_items(id, account_id, feed, source, title, link, summary, published_at, fetched_at)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  let added = 0;
  for (const i of items) {
    // Item com data no futuro (fuso errado na fonte) fica com a hora da leitura.
    const published = Date.parse(i.published) > now ? new Date(now).toISOString() : i.published;
    added += Number(ins.run(itemId(i.link), accountId, feed, i.source, i.title, i.link, i.summary, published, now).changes);
  }
  db.prepare('DELETE FROM radar_items WHERE account_id = ? AND fetched_at < ?').run(accountId, now - KEEP_DAYS * 24 * HOUR);
  return added;
}

const STOP = new Set(
  'para pelo pela pelos pelas com sem sobre entre ainda apos antes depois quando onde como mais menos muito muita esse essa este esta isso isto aquele aquela seus suas dele dela eles elas voce vocês todos todas tudo nada pode podem deve devem sera serao foram fazer faz feito tem teve ter havia está estao sendo vai vao jogo time clube contra'.split(
    ' ',
  ),
);

/** Palavras que diferenciam a notícia (sem as do tema, que todas têm). */
export function tokens(title: string, topicWords: Set<string>): Set<string> {
  return new Set(
    normalize(title)
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !STOP.has(w) && !topicWords.has(w)),
  );
}

function similar(a: Set<string>, b: Set<string>): boolean {
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  const union = a.size + b.size - shared;
  return shared >= 2 && shared / union >= 0.25;
}

export type Temperature = 'quente' | 'morna' | 'fria';
export const RADAR_KINDS: Record<string, string> = {
  ultima_hora: 'Última hora',
  mercado: 'Mercado',
  jogo: 'Jogo',
  bastidor: 'Bastidores',
  opiniao: 'Opinião',
  historia: 'História',
  outro: 'Outro',
};

export interface RadarCluster {
  /** id do item que representa o grupo (o primeiro publicado). */
  id: string;
  title: string;
  summary: string;
  items: { source: string; title: string; link: string; published: string }[];
  sources: number;
  firstAt: string;
  lastAt: string;
  temperature: Temperature;
  kind: string | null;
  kindLabel: string | null;
  confirmed: number | null;
  relevance: number | null;
  status: 'novo' | 'usado' | 'ignorado';
  draftId: number | null;
  jobId: string | null;
}

interface Row {
  id: string;
  source: string;
  title: string;
  link: string;
  summary: string;
  published_at: string;
  kind: string | null;
  confirmed: number | null;
  relevance: number | null;
  status: string;
  draft_id: number | null;
  job_id: string | null;
}

export function temperature(sources: number, lastAt: number, kind: string | null, relevance: number | null, now: number): Temperature {
  const age = (now - lastAt) / HOUR;
  if ((sources >= 3 && age <= 6) || (kind === 'ultima_hora' && (relevance ?? 0) >= 0.7 && age <= 3)) return 'quente';
  if (sources >= 2 || age <= 12) return 'morna';
  return 'fria';
}

const TEMP_ORDER: Record<Temperature, number> = { quente: 0, morna: 1, fria: 2 };

/** Junta a mesma notícia de vários veículos e ordena: quentes primeiro, depois por fontes e recência. */
export function clusters(db: DatabaseSync, radar: RadarConfig, accountId: string, now = Date.now()): RadarCluster[] {
  const rows = db
    .prepare(
      `SELECT id, source, title, link, summary, published_at, kind, confirmed, relevance, status, draft_id, job_id
       FROM radar_items WHERE account_id = ? AND published_at >= ? ORDER BY published_at ASC`,
    )
    .all(accountId, new Date(now - RADAR_HOURS * HOUR).toISOString()) as unknown as Row[];
  const topicWords = new Set(radar.keywords.flatMap((k) => normalize(k).split(/\s+/)).concat(normalize(radar.topic).split(/\s+/)));
  const groups: { rows: Row[]; toks: Set<string>[] }[] = [];
  for (const r of rows) {
    const t = tokens(r.title, topicWords);
    const g = groups.find((x) => x.toks.some((o) => similar(t, o)));
    if (g) {
      g.rows.push(r);
      g.toks.push(t);
    } else groups.push({ rows: [r], toks: [t] });
  }
  return groups
    .map(({ rows: g }): RadarCluster => {
      const rep = g[0];
      const lastAt = g[g.length - 1].published_at;
      const sources = new Set(g.map((r) => r.source)).size;
      return {
        id: rep.id,
        title: g[g.length - 1].title,
        summary: g.map((r) => r.summary).find((s) => s.length > 40) ?? '',
        items: g
          .map((r) => ({ source: r.source, title: r.title, link: r.link, published: r.published_at }))
          .reverse(),
        sources,
        firstAt: rep.published_at,
        lastAt,
        temperature: temperature(sources, Date.parse(lastAt), rep.kind, rep.relevance, now),
        kind: rep.kind,
        kindLabel: rep.kind ? (RADAR_KINDS[rep.kind] ?? rep.kind) : null,
        confirmed: rep.confirmed,
        relevance: rep.relevance,
        status: (rep.status as RadarCluster['status']) ?? 'novo',
        draftId: rep.draft_id,
        jobId: rep.job_id,
      };
    })
    .sort(
      (a, b) =>
        TEMP_ORDER[a.temperature] - TEMP_ORDER[b.temperature] || b.sources - a.sources || b.lastAt.localeCompare(a.lastAt),
    );
}

// ---------- Jev ----------

const QUESTIONS: Record<string, Question> = {
  tipo: {
    type: 'choice',
    instructions: { pergunta: 'Que tipo de notícia é esta?', foco: ['manchete', 'outras_manchetes'] },
    criteria: {
      ultima_hora: 'Fato novo e importante: resultado, contratação ou saída confirmada, lesão, demissão, punição, decisão',
      mercado: 'Negociação, interesse ou rumor de contratação ou venda',
      jogo: 'Prévia, escalação, análise ou repercussão de partida',
      bastidor: 'Bastidores, finanças, diretoria, política do clube',
      opiniao: 'Coluna, opinião ou análise pessoal',
      historia: 'Memória, aniversário, história',
      outro: 'Outro assunto',
    },
  },
  confirmado: {
    type: 'noul',
    instructions: 'As manchetes descrevem um fato confirmado (oficial ou já acontecido), e não um rumor, especulação ou "pode"?',
  },
  relevancia: {
    type: 'noul',
    instructions: 'É uma notícia que a maioria dos torcedores ou interessados no tema vai querer saber agora?',
  },
};

/** Classifica os grupos mais quentes ainda sem classificação (no item que representa cada grupo). */
export async function classifyClusters(
  db: DatabaseSync,
  jev: JevClient,
  account: AccountConfig,
  list: RadarCluster[],
  max = CLASSIFY_TOP,
): Promise<number> {
  const save = db.prepare('UPDATE radar_items SET kind = ?, confirmed = ?, relevance = ?, classified_at = ? WHERE id = ?');
  let done = 0;
  for (const c of list.filter((x) => x.kind === null).slice(0, max)) {
    const r = await jev.systemOne(
      {
        tema: account.radar!.topic,
        manchete: c.title,
        outras_manchetes: c.items.slice(1, 5).map((i) => i.title),
        resumo: c.summary.slice(0, 400),
      },
      QUESTIONS,
    );
    logCall(db, account.id, 'radar', r);
    const a = r.answers;
    save.run(
      a.tipo?.type === 'choice' ? a.tipo.choice : 'outro',
      a.confirmado?.type === 'noul' ? a.confirmado.noul : null,
      a.relevancia?.type === 'noul' ? a.relevancia.noul : null,
      Date.now(),
      c.id,
    );
    done++;
  }
  return done;
}

// ---------- Atualizar ----------

export interface RefreshResult {
  added: number;
  read: number;
  classified: number;
  feeds: { name: string; ok: boolean; items: number; error?: string }[];
}

const lastRefresh = new Map<string, number>();
export const lastRadarRefresh = (accountId: string) => lastRefresh.get(accountId) ?? null;

export async function refreshRadar(
  db: DatabaseSync,
  account: AccountConfig,
  jev: JevClient | null,
  fetcher: (url: string) => Promise<string> = fetchFeed,
  now = Date.now(),
): Promise<RefreshResult> {
  const radar = account.radar!;
  const feeds = await Promise.all(
    radar.feeds.map(async (f) => {
      try {
        let items = parseFeed(await fetcher(f.url), f.name);
        if (f.filter) items = items.filter((i) => matchesTopic(i, radar.keywords));
        return { name: f.name, ok: true, items };
      } catch (e) {
        return { name: f.name, ok: false, items: [] as FeedItem[], error: (e as Error).message };
      }
    }),
  );
  let added = 0;
  for (const f of feeds) added += saveItems(db, account.id, f.name, f.items, now);
  let classified = 0;
  if (jev) {
    try {
      classified = await classifyClusters(db, jev, account, clusters(db, radar, account.id, now));
    } catch {
      // Jev fora do ar: o Radar funciona sem a classificação.
    }
  }
  lastRefresh.set(account.id, now);
  return {
    added,
    read: feeds.reduce((a, f) => a + f.items.length, 0),
    classified,
    feeds: feeds.map((f) => ({ name: f.name, ok: f.ok, items: f.items.length, error: f.error })),
  };
}

/** Rascunho criado a partir do grupo: guarda o trabalho e, quando ele termina, o id do rascunho. */
export function linkGeneration(db: DatabaseSync, clusterId: string, jobId: string): void {
  db.prepare("UPDATE radar_items SET status = 'usado', job_id = ? WHERE id = ?").run(jobId, clusterId);
}

/** Completa o id do rascunho dos grupos cuja geração já terminou. */
export function resolveDrafts(db: DatabaseSync, list: RadarCluster[]): RadarCluster[] {
  const save = db.prepare('UPDATE radar_items SET draft_id = ? WHERE id = ?');
  return list.map((c) => {
    if (c.draftId || !c.jobId) return c;
    const draftId = getJob(c.jobId)?.items[0]?.draftId;
    if (!draftId) return c;
    save.run(draftId, c.id);
    return { ...c, draftId };
  });
}

export function setClusterStatus(db: DatabaseSync, clusterId: string, status: 'novo' | 'ignorado'): void {
  db.prepare('UPDATE radar_items SET status = ? WHERE id = ?').run(status, clusterId);
}

/** Briefing do post de notícia: só os fatos das fontes, com crédito; rumor dito como rumor. */
export function newsBrief(c: RadarCluster): string {
  const sources = [...new Set(c.items.map((i) => i.source))];
  const confirmed = (c.confirmed ?? 0) >= 0.6;
  return [
    `Notícia das últimas horas: ${c.title}`,
    `Manchetes das fontes:\n${c.items
      .slice(0, 5)
      .map((i) => `- ${i.source}: ${i.title}`)
      .join('\n')}`,
    c.summary ? `Resumo: ${c.summary}` : '',
    confirmed
      ? 'Situação: fato confirmado pelas fontes.'
      : 'Situação: NÃO CONFIRMADO. Trate como rumor: "segundo o ' + sources[0] + '…", "informação ainda não confirmada".',
    `Regras: escreva com as suas palavras (não copie frases das fontes); use só os fatos acima, sem inventar placar, valor, data ou declaração; 1ª linha com o fato, direto, porque é notícia quente; termine com "Fonte: ${sources.slice(0, 2).join(', ')}"; não ofenda rivais nem pessoas; até 3 hashtags.`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export interface Pauta {
  theme: string;
  kind: GenKind;
  description: string;
}

/** O Claude sugere pautas de uma série do Raio-X (só a lista; os posts saem pelo gerador). */
export async function suggestPautas(
  account: AccountConfig,
  serie: string,
  claude: (user: string) => Promise<string>,
  count = 8,
): Promise<Pauta[]> {
  const topic = account.radar?.topic ?? account.label;
  const text = await claude(`# Tarefa
Sugira ${count} pautas para a série "${serie}" de uma página do Instagram sobre ${topic}.
Varie o formato: carrossel para listas e linhas do tempo, Reels para lances e histórias contadas, post para curiosidades e frases.
Prefira fatos amplamente documentados; se uma pauta depender de dado incerto, diga na descrição o que precisa ser conferido.

Responda SOMENTE com um JSON válido, sem texto antes ou depois:
[{"titulo": "...", "formato": "carrossel" | "reels" | "post", "descricao": "uma linha com o ângulo da pauta"}]`);
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  let list: unknown;
  try {
    list = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error('O Claude não devolveu as pautas no formato esperado. Tente de novo.');
  }
  const kinds: Record<string, GenKind> = { carrossel: 'carousel', reels: 'reel', reel: 'reel', post: 'image' };
  return (Array.isArray(list) ? list : [])
    .filter((p): p is { titulo: string; formato?: string; descricao?: string } => typeof p?.titulo === 'string' && !!p.titulo.trim())
    .slice(0, count)
    .map((p) => ({ theme: p.titulo.trim(), kind: kinds[String(p.formato).toLowerCase()] ?? 'carousel', description: String(p.descricao ?? '').trim() }));
}

export function historyBrief(topic: string, serie: string): string {
  return [
    `Conteúdo histórico da série "${serie}" sobre ${topic}.`,
    'Regras: use apenas fatos amplamente documentados. Se não tiver certeza de uma data, placar, número ou nome, escreva [CONFERIR] ao lado, para a dona da página checar antes de publicar.',
    'Não invente frases de entrevistas: cite só declarações conhecidas, dizendo quem disse e quando ([CONFERIR] se houver dúvida).',
  ].join('\n');
}
