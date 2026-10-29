// Agenda de publicações. Exigem sessão (aplicada em server.ts).
import express, { type NextFunction, type Request, type Response } from 'express';
import { findAccount } from './config.ts';
import { db } from './db.ts';
import { InstagramError } from './instagram.ts';
import type { PublishRequest } from './publish.ts';
import {
  PublishError,
  cancelSchedule,
  createSchedule,
  listSchedule,
  publishFor,
  reschedule,
  runScheduled,
  tunnelOk,
  type Publisher,
  type TunnelCheck,
} from './schedule.ts';

const handle =
  (fn: (req: Request, res: Response) => Promise<void> | void) => (req: Request, res: Response, next: NextFunction) => {
    try {
      Promise.resolve(fn(req, res)).catch(next);
    } catch (e) {
      next(e);
    }
  };

function accountId(req: Request): string {
  const a = findAccount(req.params.id as string);
  if (!a) throw new PublishError(404, 'Conta desconhecida.');
  return a.id;
}

const at = (v: unknown) => (typeof v === 'number' ? v : Date.parse(String(v ?? '')));

/** `deps` é trocado nos testes (publicação e túnel falsos). */
export function scheduleRoutes(deps: () => { publisher: Publisher; tunnel: TunnelCheck } = () => ({ publisher: (id, r) => publishFor(db, id, r), tunnel: tunnelOk })) {
  const r = express.Router();

  r.get(
    '/accounts/:id/schedule',
    handle((req, res) => {
      res.json(listSchedule(db, accountId(req)));
    }),
  );

  r.post(
    '/accounts/:id/schedule',
    handle((req, res) => {
      const id = accountId(req);
      const b = req.body ?? {};
      const draftId = Number.isInteger(b.draftId) ? (b.draftId as number) : null;
      res.status(201).json(createSchedule(db, id, b.request as PublishRequest, at(b.at), draftId));
    }),
  );

  r.patch(
    '/schedule/:sid',
    handle((req, res) => {
      res.json(reschedule(db, Number(req.params.sid), at(req.body?.at)));
    }),
  );

  r.delete(
    '/schedule/:sid',
    handle((req, res) => {
      res.json(cancelSchedule(db, Number(req.params.sid)));
    }),
  );

  /** Publica já (falhou no horário, ou você não quer esperar). */
  r.post(
    '/schedule/:sid/publish',
    handle(async (req, res) => {
      const d = deps();
      res.json(await runScheduled(db, Number(req.params.sid), d.publisher, d.tunnel));
    }),
  );

  r.use((err: Error, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof PublishError) return void res.status(err.status).json({ error: err.message });
    if (err instanceof InstagramError) return void res.status(502).json({ error: err.message });
    next(err);
  });
  return r;
}
