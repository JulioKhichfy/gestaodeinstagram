// Gerador de posts em lote. Para cada tema: o Claude escreve; o Jev avalia a legenda e, abaixo da meta, as dicas
// dele viram instrução para o Claude reescrever (o Jev julga, não escreve); o Pexels sugere fotos/vídeos e o Jev
// ordena por relevância. Cada post vira um rascunho: publicar continua sendo decisão manual.
import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { buildSystemPrompt, completeClaude } from './claude.ts';
import type { AccountConfig } from './config.ts';
import { jevClient, jevConfigured, type JevClient } from './jev.ts';
import { MIN_CONFIDENCE, logCall, reviewCaption, type CaptionReview } from './review.ts';
import { PROVIDER_LABELS, cacheStock, searchStock, stockConfigured, type StockItem } from './stock.ts';

export const GENERATE_MAX_ITEMS = 10;
/** Nota do Jev a partir da qual a legenda é aceita sem reescrever. */
export const TARGET_GRADE = 75;
export const MAX_REWRITES = 2;
const CANDIDATES = 12;
const CAROUSEL_MAX_PHOTOS = 10;

export const GEN_KINDS = ['image', 'carousel', 'reel'] as const;
export type GenKind = (typeof GEN_KINDS)[number];
const KIND_LABELS: Record<GenKind, string> = { image: 'post estático (1 foto)', carousel: 'carrossel', reel: 'Reels' };

export type GenStep = 'fila' | 'escrevendo' | 'revisando' | 'reescrevendo' | 'midia' | 'pronto' | 'erro';

export interface GenItem {
  theme: string;
  kind: GenKind;
  /** Fatos e regras extras para o Claude (ex.: notícia do Radar com fonte, ou série histórica). */
  brief?: string;
  step: GenStep;
  /** Notas do Jev em cada versão (a 1ª é a do texto original). */
  grades: number[];
  draftId?: number;
  title?: string;
  error?: string;
  /** Avisos que não impedem o rascunho (ex.: sem chave do Pexels). */
  notes: string[];
}

export interface GenJob {
  id: string;
  accountId: string;
  rewrite: boolean;
  media: boolean;
  items: GenItem[];
  done: boolean;
  createdAt: number;
}

export interface GenDeps {
  claude: (system: string, user: string) => Promise<string>;
  jev: JevClient | null;
  stock: ((kind: 'photo' | 'video', queries: string[]) => Promise<StockItem[]>) | null;
  /** Copia para o PC as fotos que não podem ser usadas pelo link (Pixabay). */
  cache: (items: StockItem[]) => Promise<StockItem[]>;
}

export const defaultDeps = (): GenDeps => ({
  claude: (system, user) => completeClaude(system, user, { wait: true }),
  jev: jevConfigured() ? jevClient : null,
  stock: stockConfigured() ? searchStock : null,
  cache: cacheStock,
});

const jobs = new Map<string, GenJob>();
const pending = new Map<string, Promise<void>>();

/** Promessa que resolve quando o trabalho termina (testes). */
export const jobFinished = (id: string) => pending.get(id) ?? Promise.resolve();

export const getJob = (id: string) => jobs.get(id);

export const runningJob = (accountId: string) => [...jobs.values()].find((j) => j.accountId === accountId && !j.done);

// ---------- Texto ----------

export interface Written {
  title: string;
  caption: string;
  slides: string[];
  script: string;
  searchTerms: string[];
}

export function writePrompt(theme: string, kind: GenKind, brief?: string): string {
  return `# Tarefa
Crie um ${KIND_LABELS[kind]} para o Instagram sobre o tema abaixo.
Tema: ${theme}
${brief ? `
# Informações e regras deste post (prevalecem sobre o resto)
${brief}
` : ''}
Responda SOMENTE com um objeto JSON válido, sem texto antes ou depois e sem bloco de código, neste formato:
{"titulo": "...", "legenda": "...", "slides": [], "roteiro": "", "busca_midia": []}

- titulo: nome curto do post (até 60 caracteres), para a lista de rascunhos.
- legenda: legenda completa e pronta para publicar: gancho forte na 1ª linha (aparece antes do "mais"), corpo de valor, chamada para ação clara no final e até 5 hashtags específicas.
- slides: ${kind === 'carousel' ? 'de 5 a 10 textos curtos, um por slide (slide 1 = capa com gancho; último = chamada para ação).' : 'lista vazia [].'}
- roteiro: ${kind === 'reel' ? 'roteiro de 15 a 45 segundos: GANCHO (0-3 s, falado e em texto na tela), cenas curtas com o que aparece e chamada para ação final.' : 'texto vazio "".'}
- busca_midia: 2 ou 3 buscas curtas EM INGLÊS para achar ${kind === 'reel' ? 'vídeos verticais' : 'fotos'} num banco de imagens que ilustrem o tema (cenas e objetos concretos; sem pessoas famosas, marcas ou texto).`;
}

const strings = (v: unknown, max: number) =>
  (Array.isArray(v) ? v : []).filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim()).slice(0, max);

/** Lê o JSON pedido ao Claude, tolerando texto ou bloco de código em volta. */
export function parseWritten(text: string, theme: string): Written {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error('O Claude não devolveu o post no formato esperado. Tente de novo.');
  }
  const caption = typeof data.legenda === 'string' ? data.legenda.trim() : '';
  if (!caption) throw new Error('O Claude devolveu o post sem legenda. Tente de novo.');
  const title = typeof data.titulo === 'string' && data.titulo.trim() ? data.titulo.trim() : theme;
  const terms = strings(data.busca_midia, 3);
  return {
    title: title.slice(0, 120),
    caption,
    slides: strings(data.slides, CAROUSEL_MAX_PHOTOS),
    script: typeof data.roteiro === 'string' ? data.roteiro.trim() : '',
    searchTerms: terms.length ? terms : [theme],
  };
}

/** As dicas do Jev viram a instrução de reescrita do Claude. */
export function rewritePrompt(theme: string, caption: string, review: CaptionReview): string {
  const dims = review.dimensions.map((d) => `- ${d.label}: ${Math.round(d.value * 100)}% (${d.level})`).join('\n');
  const advice = [...review.warnings, ...review.tips].map((t) => `- ${t}`).join('\n') || '- Deixe o gancho mais específico e a chamada para ação mais clara.';
  return `# Tarefa
Reescreva a legenda abaixo para melhorar a avaliação. Um avaliador automático (Jev) deu nota ${review.grade}/100; a meta é ${TARGET_GRADE}.
Tema: ${theme}

# Avaliação por dimensão
${dims}
- Objetivo identificado: ${review.objective.label}

# O que melhorar
${advice}

# Legenda atual
${caption}

Mantenha o tema, a voz da conta e os fatos (não invente preços, dados nem promessas). Devolva SOMENTE a nova legenda, pronta para publicar.`;
}

/** Tira aspas ou bloco de código que o Claude às vezes coloca em volta da legenda. */
export const cleanCaption = (text: string) =>
  text
    .trim()
    .replace(/^```[a-z]*\n?|\n?```$/g, '')
    .replace(/^"([\s\S]*)"$/, '$1')
    .trim();

// ---------- Mídia ----------

/** O Jev julga, pela descrição, se cada foto/vídeo combina com o tema (uma chamada para todos). */
export async function rankStock(
  db: DatabaseSync,
  jev: JevClient | null,
  accountId: string,
  theme: string,
  caption: string,
  items: StockItem[],
): Promise<StockItem[]> {
  if (!jev || !items.length) return items;
  const questions = Object.fromEntries(
    items.map((i) => [
      i.id,
      {
        type: 'noul' as const,
        instructions: `Uma ${i.kind === 'video' ? 'cena de vídeo' : 'foto'} descrita como "${i.description}" ilustra bem este tema num post do Instagram?`,
      },
    ]),
  );
  const r = await jev.systemOne({ tema: theme, legenda: caption.slice(0, 600) }, questions);
  logCall(db, accountId, 'midia', r);
  return items
    .map((i) => {
      const a = r.answers?.[i.id];
      return { ...i, relevance: a?.type === 'noul' ? a.noul : undefined };
    })
    .sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0));
}

function selectMedia(kind: GenKind, candidates: StockItem[], slides: number): StockItem[] {
  const count = kind === 'carousel' ? Math.min(CAROUSEL_MAX_PHOTOS, Math.max(2, slides || 5)) : 1;
  return candidates.map((item, i) => ({ ...item, selected: i < count }));
}

// ---------- Rascunho ----------

function draftNotes(item: GenItem, written: Written, media: StockItem[]): string {
  const parts = [`Tema: ${item.theme}`];
  if (item.grades.length) parts.push(`Nota do Jev: ${item.grades.join(' → ')}${item.grades.length > 1 ? ' (ficou a melhor versão)' : ''}`);
  if (written.slides.length) parts.push(`Textos dos slides:\n${written.slides.map((s, i) => `${i + 1}. ${s}`).join('\n')}`);
  if (written.script) parts.push(`Roteiro do Reels:\n${written.script}`);
  const chosen = media.filter((m) => m.selected);
  const credits = [...new Set(chosen.map((m) => m.credit))];
  if (credits.length) {
    const sources = [...new Set(chosen.map((m) => PROVIDER_LABELS[m.provider]))].join(', ');
    const first = chosen[0];
    parts.push(`Mídia: ${sources} (${credits.join(', ')}). Crédito sugerido na legenda: "Foto: ${first.credit} / ${PROVIDER_LABELS[first.provider]}".`);
  }
  if (item.notes.length) parts.push(item.notes.map((n) => `Aviso: ${n}`).join('\n'));
  return parts.join('\n\n');
}

async function generateOne(db: DatabaseSync, deps: GenDeps, account: AccountConfig, job: GenJob, item: GenItem): Promise<void> {
  const system = buildSystemPrompt(db, { account, artifact: 'legenda', instruction: '' });
  item.step = 'escrevendo';
  const written = parseWritten(await deps.claude(system, writePrompt(item.theme, item.kind, item.brief)), item.theme);
  item.title = written.title;

  let best: { caption: string; review: CaptionReview | null } = { caption: written.caption, review: null };
  if (deps.jev) {
    try {
      item.step = 'revisando';
      best.review = await reviewCaption(db, deps.jev, account, { caption: best.caption, kind: item.kind });
      item.grades.push(best.review.grade);
      for (let round = 0; job.rewrite && round < MAX_REWRITES && best.review!.grade < TARGET_GRADE; round++) {
        item.step = 'reescrevendo';
        const caption = cleanCaption(await deps.claude(system, rewritePrompt(item.theme, best.caption, best.review!)));
        item.step = 'revisando';
        const review = await reviewCaption(db, deps.jev, account, { caption, kind: item.kind });
        item.grades.push(review.grade);
        if (review.grade > best.review!.grade) best = { caption, review };
      }
    } catch (e) {
      item.notes.push(`Revisão do Jev interrompida: ${(e as Error).message}`);
    }
  }

  let media: StockItem[] = [];
  if (job.media) {
    if (!deps.stock) item.notes.push('Sem chave de banco de imagens no .env (UNSPLASH_ACCESS_KEY ou PIXABAY_API_KEY): o rascunho ficou sem sugestões de foto/vídeo.');
    else {
      item.step = 'midia';
      try {
        const found = await deps.stock(item.kind === 'reel' ? 'video' : 'photo', written.searchTerms);
        let ranked = await rankStock(db, deps.jev, account.id, item.theme, best.caption, found).catch(() => found);
        // Reels: vertical primeiro; dentro de cada grupo vale a ordem do Jev.
        if (item.kind === 'reel') ranked = [...ranked.filter((m) => m.vertical), ...ranked.filter((m) => !m.vertical)];
        media = selectMedia(item.kind, await deps.cache(ranked.slice(0, CANDIDATES)), written.slides.length);
        if (!media.length) item.notes.push('Nenhuma foto/vídeo encontrado no banco de imagens para este tema.');
        else if (item.kind === 'reel' && !media[0].vertical)
          item.notes.push('Só achei vídeos horizontais: no Reels eles aparecem com faixas. Prefira gravar um vídeo vertical.');
      } catch (e) {
        item.notes.push((e as Error).message);
      }
    }
  }

  const tag = (c: CaptionReview['hook']) => (c && c.confidence >= MIN_CONFIDENCE ? c.value : null);
  const grade = best.review?.grade ?? null;
  const now = Date.now();
  const r = db
    .prepare(
      `INSERT INTO drafts(account_id, title, kind, status, body, notes, hook, style, media, jev_grade, created_at, updated_at)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      account.id,
      written.title,
      item.kind,
      grade == null || grade >= TARGET_GRADE ? 'pronto' : 'produzindo',
      best.caption,
      draftNotes(item, written, media),
      tag(best.review?.hook ?? null),
      tag(best.review?.style ?? null),
      JSON.stringify(media),
      grade,
      now,
      now,
    );
  item.draftId = Number(r.lastInsertRowid);
  item.step = 'pronto';
}

/** Cria o trabalho e roda em segundo plano (um post de cada vez). */
export function startGeneration(
  db: DatabaseSync,
  account: AccountConfig,
  requests: { theme: string; kind: GenKind; brief?: string }[],
  opts: { rewrite: boolean; media: boolean },
  deps: GenDeps = defaultDeps(),
): GenJob {
  for (const [id, j] of jobs) if (j.done && Date.now() - j.createdAt > 60 * 60 * 1000) jobs.delete(id);
  const job: GenJob = {
    id: crypto.randomUUID(),
    accountId: account.id,
    ...opts,
    items: requests.map((r) => ({ ...r, step: 'fila', grades: [], notes: [] })),
    done: false,
    createdAt: Date.now(),
  };
  jobs.set(job.id, job);
  const run = (async () => {
    for (const item of job.items) {
      try {
        await generateOne(db, deps, account, job, item);
      } catch (e) {
        item.step = 'erro';
        item.error = (e as Error).message;
      }
    }
    job.done = true;
    pending.delete(job.id);
  })();
  pending.set(job.id, run);
  return job;
}
