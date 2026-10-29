// Captar clientes: comentários dos posts como clientes em potencial. Exigem sessão (aplicada em server.ts).
import express, { type NextFunction, type Request, type Response } from 'express';
import { askClaude, ClaudeError } from './claude.ts';
import { findAccount } from './config.ts';
import { db } from './db.ts';
import { InstagramError } from './instagram.ts';
import { jevClient, jevConfigured, type JevClient } from './jev.ts';
import {
  LEAD_STATUSES,
  LeadError,
  classifyComments,
  commentsApi,
  getLead,
  hasCommentsPermission,
  leadStats,
  listLeads,
  markReplied,
  syncComments,
  updateLead,
  type CommentsApi,
  type LeadStatus,
} from './leads.ts';
import { connectionAuth, read } from './store.ts';

const handle =
  (fn: (req: Request, res: Response) => Promise<void> | void) => (req: Request, res: Response, next: NextFunction) => {
    try {
      Promise.resolve(fn(req, res)).catch(next);
    } catch (e) {
      next(e);
    }
  };

/** Instagram aceita respostas de até 2.200 caracteres; resposta a comentário boa é curta. */
const REPLY_MAX = 2200;

export interface LeadDeps {
  api: CommentsApi;
  jev: JevClient | null;
}

const defaultDeps = (): LeadDeps => ({ api: commentsApi, jev: jevConfigured() ? jevClient : null });

function accountOf(req: Request) {
  const a = findAccount(req.params.id as string);
  if (!a) throw new LeadError(404, 'Conta desconhecida.');
  return a;
}

/** Conexão ativa com a permissão de comentários, ou erro claro do que falta. */
function commentsConnection(accountId: string) {
  const c = read().connections[accountId];
  if (!c || c.tokenExpiresAt < Date.now()) throw new LeadError(409, 'Conta não conectada. Conecte na página da conta.');
  if (!hasCommentsPermission(c.permissions)) {
    throw new LeadError(409, 'Falta a permissão de comentários: reconecte a conta (página da conta › Reconectar) e aceite a nova permissão.');
  }
  return { auth: connectionAuth(accountId)!, username: c.username };
}

/** `deps` é trocado nos testes por dublês da API do Instagram e do Jev. */
export function leadsRoutes(deps: () => LeadDeps = defaultDeps) {
  const r = express.Router();

  r.get(
    '/accounts/:id/leads/status',
    handle((req, res) => {
      const a = accountOf(req);
      const c = read().connections[a.id];
      res.json({
        connected: Boolean(c && c.tokenExpiresAt > Date.now()),
        hasPermission: hasCommentsPermission(c?.permissions),
        via: c?.via ?? (c ? 'instagram' : null),
        jev: jevConfigured(),
      });
    }),
  );

  r.get(
    '/accounts/:id/leads',
    handle((req, res) => {
      const status = String(req.query.status ?? 'novo');
      if (status !== 'todos' && !(LEAD_STATUSES as readonly string[]).includes(status)) throw new LeadError(400, 'Status inválido.');
      res.json(listLeads(db, accountOf(req).id, status as LeadStatus | 'todos'));
    }),
  );

  r.get(
    '/accounts/:id/leads/stats',
    handle((req, res) => {
      res.json(leadStats(db, accountOf(req).id, Math.min(365, Math.max(7, Number(req.query.days) || 30))));
    }),
  );

  /** Lê os comentários novos agora e classifica (também roda sozinho na sincronização a cada 6 h). */
  r.post(
    '/accounts/:id/leads/refresh',
    handle(async (req, res) => {
      const a = accountOf(req);
      const { auth, username } = commentsConnection(a.id);
      const d = deps();
      const synced = await syncComments(db, d.api, a.id, auth, username);
      const classified = await classifyComments(db, d.jev, a);
      res.json({ ...synced, ...classified });
    }),
  );

  r.patch(
    '/leads/:commentId',
    handle((req, res) => {
      res.json(updateLead(db, req.params.commentId as string, req.body ?? {}));
    }),
  );

  /** Resposta sugerida pelo Claude, no tom da conta (não envia nada). */
  r.post(
    '/leads/:commentId/suggest',
    handle(async (req, res) => {
      const lead = getLead(db, req.params.commentId as string);
      if (!lead) throw new LeadError(404, 'Comentário não encontrado.');
      const text = await askClaude(db, {
        account: findAccount(lead.accountId)!,
        artifact: 'resposta',
        instruction: String(req.body?.instruction ?? '').slice(0, 500),
        currentText: `Post: ${lead.media.caption}\n\nComentário de @${lead.username ?? 'alguém'}: ${lead.text}`,
      });
      res.json({ text });
    }),
  );

  /** Responde ao comentário no Instagram (só com o clique de quem usa o dashboard). */
  r.post(
    '/leads/:commentId/reply',
    handle(async (req, res) => {
      const lead = getLead(db, req.params.commentId as string);
      if (!lead) throw new LeadError(404, 'Comentário não encontrado.');
      const message = String(req.body?.message ?? '').trim();
      if (!message) throw new LeadError(400, 'Escreva a resposta.');
      if (message.length > REPLY_MAX) throw new LeadError(400, `A resposta passa de ${REPLY_MAX} caracteres.`);
      const { auth } = commentsConnection(lead.accountId);
      await deps().api.reply(auth, lead.id, message);
      markReplied(db, lead.id, message);
      res.json(getLead(db, lead.id));
    }),
  );

  r.use((err: Error, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof LeadError) return void res.status(err.status).json({ error: err.message });
    if (err instanceof ClaudeError) return void res.status(503).json({ error: err.message });
    if (err instanceof InstagramError) return void res.status(502).json({ error: err.message.replace(/^Instagram:/, 'Meta:') });
    next(err);
  });
  return r;
}
