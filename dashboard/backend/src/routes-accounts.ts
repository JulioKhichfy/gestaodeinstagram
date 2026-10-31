// Tela Contas: adicionar, editar, remover contas e editar o perfil de cada uma. Exigem sessão (aplicada em server.ts).
import express, { type NextFunction, type Request, type Response } from 'express';
import { AccountError, addAccount, readProfile, removeAccount, updateAccount, writeProfile } from './accounts.ts';
import { ACCOUNTS } from './config.ts';
import { read } from './store.ts';
import { syncAccount } from './sync.ts';

const handle =
  (fn: (req: Request, res: Response) => Promise<void> | void) => (req: Request, res: Response, next: NextFunction) => {
    try {
      Promise.resolve(fn(req, res)).catch(next);
    } catch (e) {
      next(e);
    }
  };

export const accountAdmin = express.Router();

/** Contas do dashboard e as que o login do Facebook encontrou (para adicionar com um clique). */
accountAdmin.get('/contas', (_req, res) => {
  const { connections, facebook } = read();
  const usernames = new Set(ACCOUNTS.map((a) => a.username.toLowerCase()));
  res.json({
    facebook: facebook ? { name: facebook.name, expiresAt: facebook.tokenExpiresAt, connected: facebook.tokenExpiresAt > Date.now() } : null,
    available: (facebook?.available ?? []).map((a) => ({ ...a, added: usernames.has(a.username.toLowerCase()) })),
    accounts: ACCOUNTS.map((a) => {
      const c = connections[a.id];
      return { id: a.id, label: a.label, username: a.username, business: a.business, connected: Boolean(c && c.tokenExpiresAt > Date.now()), via: c?.via ?? (c ? 'instagram' : null) };
    }),
  });
});

accountAdmin.post(
  '/contas',
  handle((req, res) => {
    const r = addAccount(req.body ?? {});
    if (r.connected) syncAccount(r.account.id).catch((e) => console.error('sync:', e));
    res.status(201).json(r);
  }),
);

accountAdmin.patch(
  '/contas/:id',
  handle((req, res) => {
    res.json(updateAccount(req.params.id as string, req.body ?? {}));
  }),
);

accountAdmin.delete(
  '/contas/:id',
  handle((req, res) => {
    removeAccount(req.params.id as string);
    res.status(204).end();
  }),
);

accountAdmin.get(
  '/contas/:id/perfil',
  handle((req, res) => {
    res.json({ text: readProfile(req.params.id as string) });
  }),
);

accountAdmin.put(
  '/contas/:id/perfil',
  handle((req, res) => {
    writeProfile(req.params.id as string, req.body?.text);
    res.status(204).end();
  }),
);

accountAdmin.use((err: Error, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof AccountError) return void res.status(err.status).json({ error: err.message });
  next(err);
});
