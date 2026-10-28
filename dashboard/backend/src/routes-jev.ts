// Rotas do Jev (TypeSafe AI). Exigem sessão do dashboard (aplicada em server.ts).
import express, { type NextFunction, type Request, type Response } from 'express';
import { config, findAccount } from './config.ts';
import { db } from './db.ts';
import { JevError, jevClient, jevConfigured, type JevClient } from './jev.ts';
import { AUTOTAG_MIN_CONFIDENCE, autotagPosts, jevUsage, pendingAutotag, reviewCaption } from './review.ts';

const handle =
  (fn: (req: Request, res: Response) => Promise<void> | void) => (req: Request, res: Response, next: NextFunction) => {
    try {
      Promise.resolve(fn(req, res)).catch(next);
    } catch (e) {
      next(e);
    }
  };

function accountOf(req: Request) {
  const a = findAccount(req.params.id as string);
  if (!a) throw new JevError(404, 'Conta desconhecida.');
  return a;
}

/** `client` é trocado nos testes por um falso. */
export function jevRoutes(client: JevClient = jevClient) {
  const r = express.Router();

  r.get('/jev/status', (_req, res) => {
    res.json({ configured: jevConfigured(), model: config.jevModel, autotagMinConfidence: AUTOTAG_MIN_CONFIDENCE, usage: jevUsage(db) });
  });

  r.post(
    '/accounts/:id/jev/review',
    handle(async (req, res) => {
      const caption = String(req.body?.caption ?? '').slice(0, 5000);
      res.json(await reviewCaption(db, client, accountOf(req), { caption, kind: String(req.body?.kind ?? '') }));
    }),
  );

  r.get(
    '/accounts/:id/jev/autotag',
    handle((req, res) => {
      res.json({ pending: pendingAutotag(db, accountOf(req).id) });
    }),
  );

  r.post(
    '/accounts/:id/jev/autotag',
    handle(async (req, res) => {
      res.json(await autotagPosts(db, client, accountOf(req).id));
    }),
  );

  r.use((err: Error, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof JevError) return void res.status(err.status).json({ error: err.message });
    next(err);
  });
  return r;
}
