// Publicar agora e agenda. Os dois usam o mesmo caminho (`publishFor`); a agenda roda a cada minuto em main.ts.
// Agendar exige o dashboard e o túnel ligados no horário: a Meta baixa a mídia do endereço público do PC.
import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { config, publishMissing } from './config.ts';
import { publish, validate, type PublishRequest } from './publish.ts';
import { connectionAuth, read } from './store.ts';

export class PublishError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Publica pela conta (conexão, endereço público, validação) e registra no histórico. */
export async function publishFor(db: DatabaseSync, accountId: string, req: PublishRequest): Promise<{ id: string; permalink?: string }> {
  const c = read().connections[accountId];
  if (!c || c.tokenExpiresAt < Date.now()) throw new PublishError(409, 'Conta não conectada. Conecte na página da conta.');
  const missing = publishMissing();
  if (missing) throw new PublishError(400, `Para publicar, o Instagram precisa baixar a mídia de um endereço público. Configure no backend/.env: ${missing}.`);
  const invalid = validate(req);
  if (invalid) throw new PublishError(400, invalid);
  const log = db.prepare(
    `INSERT INTO publish_log(account_id, type, caption, trial, ok, error, media_id, permalink, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const caption = (req.caption ?? '').slice(0, 300);
  try {
    const result = await publish(c.igUserId, connectionAuth(accountId)!, req);
    log.run(accountId, req.type, caption, req.trial ? 1 : 0, 1, null, result.id, result.permalink ?? null, Date.now());
    return result;
  } catch (e) {
    log.run(accountId, req.type, caption, req.trial ? 1 : 0, 0, (e as Error).message, null, null, Date.now());
    throw e;
  }
}

// ---------- Agenda ----------

export const SCHEDULE_STATUSES = ['agendado', 'publicando', 'publicado', 'falhou', 'cancelado'] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];

export interface ScheduledPost {
  id: number;
  accountId: string;
  type: PublishRequest['type'];
  caption: string;
  items: number;
  scheduledAt: number;
  status: ScheduleStatus;
  draftId: number | null;
  error: string | null;
  permalink: string | null;
  publishedAt: number | null;
}

const toPost = (r: Record<string, any>): ScheduledPost => {
  const req = JSON.parse(r.request) as PublishRequest;
  return {
    id: r.id,
    accountId: r.account_id,
    type: req.type,
    caption: (req.caption ?? '').slice(0, 300),
    items: req.items.length,
    scheduledAt: r.scheduled_at,
    status: r.status,
    draftId: r.draft_id,
    error: r.error,
    permalink: r.permalink,
    publishedAt: r.published_at,
  };
};

/** Margem mínima para agendar (o envio é verificado a cada minuto). */
const MIN_AHEAD = 60_000;

export function createSchedule(db: DatabaseSync, accountId: string, req: PublishRequest, at: number, draftId: number | null, now = Date.now()): ScheduledPost {
  if (!Number.isFinite(at)) throw new PublishError(400, 'Data e hora inválidas.');
  if (at < now + MIN_AHEAD) throw new PublishError(400, 'Escolha um horário a partir de 1 minuto no futuro (ou use Publicar agora).');
  if (at > now + 90 * 86_400_000) throw new PublishError(400, 'Agende para no máximo 90 dias à frente.');
  const invalid = validate(req);
  if (invalid) throw new PublishError(400, invalid);
  const r = db
    .prepare('INSERT INTO scheduled_posts(account_id, request, scheduled_at, draft_id, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?)')
    .run(accountId, JSON.stringify(req), at, draftId, now, now);
  return getScheduled(db, Number(r.lastInsertRowid))!;
}

export function getScheduled(db: DatabaseSync, id: number): ScheduledPost | null {
  const r = db.prepare('SELECT * FROM scheduled_posts WHERE id = ?').get(id) as Record<string, any> | undefined;
  return r ? toPost(r) : null;
}

/** Próximos primeiro; depois o histórico (últimos 30 dias). */
export function listSchedule(db: DatabaseSync, accountId: string, now = Date.now()): ScheduledPost[] {
  return (
    db
      .prepare(
        `SELECT * FROM scheduled_posts WHERE account_id = ? AND (status IN ('agendado', 'publicando', 'falhou') OR updated_at >= ?)
         ORDER BY CASE WHEN status IN ('agendado', 'publicando') THEN 0 ELSE 1 END, scheduled_at ASC`,
      )
      .all(accountId, now - 30 * 86_400_000) as Record<string, any>[]
  ).map(toPost);
}

const filesOf = (req: PublishRequest) => [...req.items, req.coverItem].filter(Boolean) as string[];

function removeFiles(req: PublishRequest): void {
  for (const f of filesOf(req)) fs.rmSync(path.join(config.mediaDir, path.basename(f)), { force: true });
}

export function cancelSchedule(db: DatabaseSync, id: number): ScheduledPost {
  const r = db.prepare('SELECT * FROM scheduled_posts WHERE id = ?').get(id) as Record<string, any> | undefined;
  if (!r) throw new PublishError(404, 'Agendamento não encontrado.');
  if (r.status === 'publicado' || r.status === 'publicando') throw new PublishError(409, 'Já foi publicado (ou está publicando agora).');
  db.prepare("UPDATE scheduled_posts SET status = 'cancelado', updated_at = ? WHERE id = ?").run(Date.now(), id);
  removeFiles(JSON.parse(r.request));
  return getScheduled(db, id)!;
}

export function reschedule(db: DatabaseSync, id: number, at: number, now = Date.now()): ScheduledPost {
  const post = getScheduled(db, id);
  if (!post) throw new PublishError(404, 'Agendamento não encontrado.');
  if (post.status !== 'agendado' && post.status !== 'falhou') throw new PublishError(409, 'Só dá para reagendar o que ainda não foi publicado.');
  if (!Number.isFinite(at) || at < now + MIN_AHEAD) throw new PublishError(400, 'Escolha um horário a partir de 1 minuto no futuro.');
  db.prepare("UPDATE scheduled_posts SET scheduled_at = ?, status = 'agendado', error = NULL, updated_at = ? WHERE id = ?").run(at, now, id);
  return getScheduled(db, id)!;
}

export type Publisher = (accountId: string, req: PublishRequest) => Promise<{ id: string; permalink?: string }>;
export type TunnelCheck = () => Promise<boolean>;

/** O endereço público (túnel) responde? Sem ele, a Meta não consegue baixar a mídia. */
export const tunnelOk: TunnelCheck = async () => {
  if (publishMissing()) return false;
  try {
    const res = await fetch(`${config.publicBaseUrl}/api/health`, { signal: AbortSignal.timeout(10_000) });
    return res.ok;
  } catch {
    return false;
  }
};

/** Publica um agendamento agora (pelo horário ou pelo botão). Mantém a mídia se falhar, para tentar de novo. */
export async function runScheduled(db: DatabaseSync, id: number, publisher: Publisher, tunnel: TunnelCheck = tunnelOk): Promise<ScheduledPost> {
  const r = db.prepare('SELECT * FROM scheduled_posts WHERE id = ?').get(id) as Record<string, any> | undefined;
  if (!r) throw new PublishError(404, 'Agendamento não encontrado.');
  if (r.status !== 'agendado' && r.status !== 'falhou') throw new PublishError(409, 'Este agendamento não está aguardando publicação.');
  const claimed = db.prepare("UPDATE scheduled_posts SET status = 'publicando', updated_at = ? WHERE id = ? AND status IN ('agendado', 'falhou')").run(Date.now(), id);
  if (!claimed.changes) throw new PublishError(409, 'Já está sendo publicado.');
  const req = JSON.parse(r.request) as PublishRequest;
  const fail = (msg: string) =>
    db.prepare("UPDATE scheduled_posts SET status = 'falhou', error = ?, updated_at = ? WHERE id = ?").run(msg, Date.now(), id);
  try {
    if (!(await tunnel())) {
      fail('O endereço público (túnel) estava desligado no horário: a Meta não consegue baixar a mídia. Abra o túnel e clique em "Publicar agora".');
    } else {
      const result = await publisher(r.account_id, req);
      db.prepare(
        "UPDATE scheduled_posts SET status = 'publicado', error = NULL, media_id = ?, permalink = ?, published_at = ?, updated_at = ? WHERE id = ?",
      ).run(result.id, result.permalink ?? null, Date.now(), Date.now(), id);
      if (r.draft_id) db.prepare("UPDATE drafts SET status = 'publicado', updated_at = ? WHERE id = ?").run(Date.now(), r.draft_id);
    }
  } catch (e) {
    fail((e as Error).message);
  }
  return getScheduled(db, id)!;
}

/** Tudo o que venceu, um de cada vez (chamado a cada minuto). Falhas não são repetidas sozinhas. */
export async function runDue(db: DatabaseSync, publisher: Publisher, tunnel: TunnelCheck = tunnelOk, now = Date.now()): Promise<number> {
  const due = db.prepare("SELECT id FROM scheduled_posts WHERE status = 'agendado' AND scheduled_at <= ? ORDER BY scheduled_at").all(now) as { id: number }[];
  for (const { id } of due) await runScheduled(db, id, publisher, tunnel).catch(() => undefined);
  return due.length;
}

/** Agendamentos que ficaram em "publicando" (backend reiniciado no meio) voltam a falhou, com aviso. */
export function recoverStuck(db: DatabaseSync): void {
  db.prepare(
    "UPDATE scheduled_posts SET status = 'falhou', error = 'O dashboard foi reiniciado durante a publicação. Confira no Instagram se saiu; se não, clique em Publicar agora.', updated_at = ? WHERE status = 'publicando'",
  ).run(Date.now());
}
