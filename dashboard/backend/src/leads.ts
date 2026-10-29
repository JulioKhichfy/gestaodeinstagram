// Captar clientes: os comentários dos posts da conta viram uma lista de clientes em potencial.
// 1) regra fixa por palavras ("quanto custa", "orçamento"…); 2) o Jev classifica a intenção e o interesse;
// 3) quem usa o dashboard acompanha o status, pede ao Claude uma resposta e responde com um clique.
// Regras da Meta respeitadas: só comentários dos posts da própria conta; nada de mensagem não solicitada,
// seguir ou curtir automaticamente. Nenhuma resposta sai sem um clique de quem usa o dashboard.
import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { accountFolder, type AccountConfig } from './config.ts';
import { COMMENTS_SCOPES, getComments, replyToComment, type Auth, type IgComment } from './instagram.ts';
import { JevError, type JevClient, type Question } from './jev.ts';
import { logCall } from './review.ts';

export const LEAD_STATUSES = ['novo', 'em_conversa', 'cliente', 'descartado'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const INTENT_LABELS: Record<string, string> = {
  compra: 'Quer comprar ou contratar',
  duvida: 'Dúvida',
  elogio: 'Elogio',
  critica: 'Crítica',
  spam: 'Spam',
  outro: 'Outro',
};

/** A partir desta probabilidade de interesse (Jev), o comentário entra na lista de clientes em potencial. */
export const LEAD_MIN_INTEREST = 0.5;
/** Posts dos últimos N dias têm os comentários lidos. */
export const COMMENT_DAYS = 60;
const CLASSIFY_BATCH = 100;
const CONCURRENCY = 4;
const DAY = 86_400_000;

export interface CommentsApi {
  getComments(auth: Auth, mediaId: string): Promise<IgComment[]>;
  reply(auth: Auth, commentId: string, message: string): Promise<{ id: string }>;
}

export const commentsApi: CommentsApi = { getComments: (auth, id) => getComments(auth, id), reply: replyToComment };

/** A conexão inclui a permissão de comentários (conexões antigas precisam reconectar). */
export const hasCommentsPermission = (permissions: string[] | undefined) => Boolean(permissions?.some((p) => COMMENTS_SCOPES.includes(p)));

// ---------- Regra fixa (antes do Jev) ----------

// Radicais sem fronteira no fim ("encomend" pega encomenda/encomendar); no começo, fronteira que entende acentos.
const BUY_WORDS =
  /(?<![\p{L}\p{N}])(quanto (custa|é|e|fica|sai)|pre[çc]os?\b|valor(es)?\b|or[çc]amento|compr(ar|o|ei)\b|encomend|parcel|frete|entrega|dispon[ií]ve|estoque|como (fa[çc]o|adquir|contrat|agend|compr)|contrat|agend|vagas?\b|inscri|whats|zap\b|direct|dm\b|me chama|quero)/iu;

/** Sinal rápido de interesse por palavras (usado também quando o Jev não está ligado). */
export const keywordInterest = (text: string) => BUY_WORDS.test(text);

// ---------- Sincronizar comentários ----------

/**
 * Lê os comentários dos posts recentes (só de quem não é a própria conta) e registra se a conta já respondeu.
 * Idempotente: pode rodar quantas vezes quiser.
 */
export async function syncComments(
  db: DatabaseSync,
  api: CommentsApi,
  accountId: string,
  auth: Auth,
  ownUsername: string,
  now = Date.now(),
): Promise<{ posts: number; fetched: number; added: number }> {
  const own = ownUsername.toLowerCase();
  const media = db
    .prepare(
      `SELECT id FROM media WHERE account_id = ? AND timestamp >= ? AND COALESCE(comments_count, 1) > 0
       ORDER BY timestamp DESC LIMIT 60`,
    )
    .all(accountId, new Date(now - COMMENT_DAYS * DAY).toISOString()) as { id: string }[];
  const exists = db.prepare('SELECT 1 FROM comments WHERE id = ?');
  const upsert = db.prepare(
    `INSERT INTO comments(id, account_id, media_id, username, text, timestamp, like_count, replied_at, reply_text, synced_at)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET text = excluded.text, like_count = excluded.like_count,
       replied_at = COALESCE(excluded.replied_at, comments.replied_at),
       reply_text = COALESCE(excluded.reply_text, comments.reply_text), synced_at = excluded.synced_at`,
  );
  let fetched = 0;
  let added = 0;
  for (const m of media) {
    for (const c of await api.getComments(auth, m.id)) {
      if (!c.text?.trim() || c.username?.toLowerCase() === own) continue;
      const ownReply = (c.replies?.data ?? [])
        .filter((r) => r.username?.toLowerCase() === own)
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];
      if (!exists.get(c.id)) added++;
      fetched++;
      upsert.run(c.id, accountId, m.id, c.username ?? null, c.text, c.timestamp, c.like_count ?? null, ownReply?.timestamp ?? null, ownReply?.text ?? null, now);
    }
  }
  return { posts: media.length, fetched, added };
}

// ---------- Classificar com o Jev ----------

const QUESTIONS: Record<string, Question> = {
  intencao: {
    type: 'choice',
    instructions: { pergunta: 'Qual é a intenção principal deste comentário?', foco: 'comentario', contexto: ['negocio', 'post'] },
    criteria: {
      compra: 'Quer comprar, contratar, agendar ou saber preço, prazo, frete ou como adquirir',
      duvida: 'Pergunta sobre o conteúdo ou o produto, sem pedir para comprar',
      elogio: 'Elogio, concordância ou reação positiva',
      critica: 'Crítica ou reclamação',
      spam: 'Propaganda de terceiros, golpe, link suspeito ou sem relação com o post',
      outro: 'Outro (marcar amigos, emoji solto, conversa)',
    },
  },
  interesse: {
    type: 'noul',
    instructions: 'A pessoa que comentou demonstra interesse em comprar ou contratar o que este negócio oferece?',
  },
  urgente: {
    type: 'noul',
    instructions: 'O comentário pede resposta rápida ou menciona uma data próxima (evento, presente, prazo)?',
  },
};

function businessProfile(account: AccountConfig): string {
  try {
    return fs.readFileSync(path.join(accountFolder(account), 'claude.md'), 'utf8').trim().slice(0, 1500);
  } catch {
    return '';
  }
}

/** Classifica os comentários ainda sem classificação (os mais recentes primeiro). Sem Jev, usa só a regra fixa. */
export async function classifyComments(
  db: DatabaseSync,
  jev: JevClient | null,
  account: AccountConfig,
  limit = CLASSIFY_BATCH,
): Promise<{ classified: number; failed: number }> {
  const rows = db
    .prepare(
      `SELECT c.id, c.text, m.caption FROM comments c LEFT JOIN media m ON m.id = c.media_id
       WHERE c.account_id = ? AND c.classified_at IS NULL ORDER BY c.timestamp DESC LIMIT ?`,
    )
    .all(account.id, limit) as { id: string; text: string; caption: string | null }[];
  const save = db.prepare('UPDATE comments SET intent = ?, intent_confidence = ?, interest = ?, urgent = ?, classified_at = ? WHERE id = ?');

  if (!jev) {
    for (const r of rows) {
      const hit = keywordInterest(r.text);
      save.run(hit ? 'compra' : null, null, hit ? 0.7 : null, null, Date.now(), r.id);
    }
    return { classified: rows.length, failed: 0 };
  }

  const negocio = businessProfile(account) || `Conta de ${account.business} @${account.username}`;
  let classified = 0;
  let failed = 0;
  let stop: Error | null = null;
  let next = 0;
  const worker = async () => {
    while (next < rows.length && !stop) {
      const r = rows[next++];
      try {
        const res = await jev.systemOne({ negocio, post: (r.caption ?? '').slice(0, 300), comentario: r.text.slice(0, 1000) }, QUESTIONS);
        logCall(db, account.id, 'clientes', res);
        const intent = res.answers.intencao;
        const interest = res.answers.interesse;
        const urgent = res.answers.urgente;
        let p = interest?.type === 'noul' ? interest.noul : 0;
        // Regra fixa como piso: "quanto custa?" não pode passar despercebido.
        if (keywordInterest(r.text)) p = Math.max(p, LEAD_MIN_INTEREST);
        save.run(
          intent?.type === 'choice' ? intent.choice : null,
          intent?.type === 'choice' ? intent.confidence : null,
          p,
          urgent?.type === 'noul' ? urgent.noul : null,
          Date.now(),
          r.id,
        );
        classified++;
      } catch (e) {
        if (e instanceof JevError && (e.status === 503 || e.status === 429)) stop = e;
        else failed++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, worker));
  if (stop && !classified) throw stop;
  return { classified, failed };
}

// ---------- Lista, status e números ----------

/** Cliente em potencial: interesse alto, intenção de compra ou já tratado (status mudou). Spam nunca. */
const LEAD_SQL = `(c.status <> 'novo' OR (COALESCE(c.intent, '') <> 'spam'
  AND (c.interest >= ${LEAD_MIN_INTEREST} OR (c.intent = 'compra' AND COALESCE(c.intent_confidence, 1) >= 0.5))))`;

export interface Lead {
  id: string;
  username: string | null;
  text: string;
  timestamp: string;
  likeCount: number | null;
  intent: string | null;
  intentLabel: string | null;
  intentConfidence: number | null;
  interest: number | null;
  urgent: number | null;
  status: LeadStatus;
  notes: string;
  dealValue: number | null;
  repliedAt: string | null;
  replyText: string | null;
  media: { id: string; permalink: string | null; thumbnail: string | null; caption: string };
}

const toLead = (r: Record<string, any>): Lead => ({
  id: r.id,
  username: r.username,
  text: r.text,
  timestamp: r.timestamp,
  likeCount: r.like_count,
  intent: r.intent,
  intentLabel: r.intent ? (INTENT_LABELS[r.intent] ?? r.intent) : null,
  intentConfidence: r.intent_confidence,
  interest: r.interest,
  urgent: r.urgent,
  status: r.status,
  notes: r.notes,
  dealValue: r.deal_value,
  repliedAt: r.replied_at,
  replyText: r.reply_text,
  media: { id: r.media_id, permalink: r.permalink, thumbnail: r.thumbnail_url, caption: (r.caption ?? '').slice(0, 200) },
});

/** status = um dos LEAD_STATUSES, ou 'todos' (todos os comentários lidos, inclusive os que não são clientes). */
export function listLeads(db: DatabaseSync, accountId: string, status: LeadStatus | 'todos' = 'novo'): Lead[] {
  const where = status === 'todos' ? 'c.account_id = ?' : `c.account_id = ? AND c.status = ? AND ${LEAD_SQL}`;
  const args = status === 'todos' ? [accountId] : [accountId, status];
  const order =
    status === 'novo' ? 'c.replied_at IS NOT NULL, COALESCE(c.urgent, 0) DESC, COALESCE(c.interest, 0) DESC, c.timestamp DESC' : 'c.timestamp DESC';
  return (
    db
      .prepare(
        `SELECT c.*, m.permalink, m.thumbnail_url, m.caption FROM comments c LEFT JOIN media m ON m.id = c.media_id
         WHERE ${where} ORDER BY ${order} LIMIT 300`,
      )
      .all(...args) as Record<string, any>[]
  ).map(toLead);
}

export function getLead(db: DatabaseSync, id: string): (Lead & { accountId: string }) | null {
  const r = db
    .prepare(`SELECT c.*, m.permalink, m.thumbnail_url, m.caption FROM comments c LEFT JOIN media m ON m.id = c.media_id WHERE c.id = ?`)
    .get(id) as Record<string, any> | undefined;
  return r ? { ...toLead(r), accountId: r.account_id } : null;
}

export class LeadError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function updateLead(db: DatabaseSync, id: string, b: { status?: unknown; notes?: unknown; dealValue?: unknown }) {
  const lead = getLead(db, id);
  if (!lead) throw new LeadError(404, 'Comentário não encontrado.');
  if (b.status !== undefined && !(LEAD_STATUSES as readonly string[]).includes(String(b.status))) throw new LeadError(400, 'Status inválido.');
  const value = b.dealValue === undefined ? lead.dealValue : b.dealValue === null || b.dealValue === '' ? null : Number(b.dealValue);
  if (value !== null && (!Number.isFinite(value) || value < 0)) throw new LeadError(400, 'Valor inválido.');
  const status = (b.status as LeadStatus | undefined) ?? lead.status;
  db.prepare('UPDATE comments SET status = ?, notes = ?, deal_value = ?, status_at = ? WHERE id = ?').run(
    status,
    typeof b.notes === 'string' ? b.notes.slice(0, 2000) : lead.notes,
    value,
    status !== lead.status ? Date.now() : null,
    id,
  );
  return getLead(db, id)!;
}

/** Depois de responder pelo dashboard: guarda a resposta e move de "novo" para "em conversa". */
export function markReplied(db: DatabaseSync, id: string, message: string, when = new Date()): void {
  db.prepare(
    `UPDATE comments SET replied_at = ?, reply_text = ?, status = CASE WHEN status = 'novo' THEN 'em_conversa' ELSE status END,
       status_at = CASE WHEN status = 'novo' THEN ? ELSE status_at END WHERE id = ?`,
  ).run(when.toISOString(), message, when.getTime(), id);
}

/** Números do período (pela data do comentário): funil e posts que mais trazem interessados. */
export function leadStats(db: DatabaseSync, accountId: string, days = 30, now = Date.now()) {
  const since = new Date(now - days * DAY).toISOString();
  const base = `FROM comments c WHERE c.account_id = ? AND c.timestamp >= ? AND ${LEAD_SQL}`;
  const funnel = db.prepare(`SELECT c.status AS status, COUNT(*) AS n, COALESCE(SUM(c.deal_value), 0) AS value ${base} GROUP BY c.status`).all(
    accountId,
    since,
  ) as { status: LeadStatus; n: number; value: number }[];
  const count = (s: LeadStatus) => funnel.find((f) => f.status === s)?.n ?? 0;
  const leads = funnel.reduce((a, f) => a + f.n, 0);
  const pending = (
    db.prepare(`SELECT COUNT(*) AS n ${base} AND c.status = 'novo' AND c.replied_at IS NULL`).get(accountId, since) as { n: number }
  ).n;
  const comments = (db.prepare('SELECT COUNT(*) AS n FROM comments WHERE account_id = ? AND timestamp >= ?').get(accountId, since) as { n: number }).n;
  const topPosts = db
    .prepare(
      `SELECT c.media_id AS mediaId, m.permalink, m.thumbnail_url AS thumbnail, SUBSTR(COALESCE(m.caption, ''), 1, 120) AS caption,
              COUNT(*) AS leads, SUM(CASE WHEN c.status = 'cliente' THEN 1 ELSE 0 END) AS clients
       FROM comments c LEFT JOIN media m ON m.id = c.media_id
       WHERE c.account_id = ? AND c.timestamp >= ? AND ${LEAD_SQL}
       GROUP BY c.media_id ORDER BY leads DESC LIMIT 5`,
    )
    .all(accountId, since);
  return {
    days,
    comments,
    leads,
    pending,
    novo: count('novo'),
    emConversa: count('em_conversa'),
    clientes: count('cliente'),
    descartados: count('descartado'),
    valor: funnel.find((f) => f.status === 'cliente')?.value ?? 0,
    conversao: leads ? Math.round((count('cliente') / leads) * 1000) / 10 : null,
    topPosts,
  };
}
