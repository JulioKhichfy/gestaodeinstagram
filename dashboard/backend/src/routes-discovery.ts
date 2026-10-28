// Login do Facebook (Descoberta e conexão das contas vinculadas a Páginas) e rotas da Descoberta.
// `facebookCallback` é público (volta do OAuth, protegido pelo state); `discovery` exige sessão (aplicada em server.ts).
import crypto from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import { ACCOUNTS, config, fbRedirectUri, findAccount, missingFacebookConfig } from './config.ts';
import { db } from './db.ts';
import {
  DiscoveryError,
  STATUSES,
  addToWatchlist,
  hashtagUsage,
  listProfiles,
  searchHashtag,
  suggestions,
  updateProfile,
  type DiscoveryConn,
} from './discovery.ts';
import * as fb from './facebook.ts';
import { InstagramError } from './instagram.ts';
import { syncAccount } from './sync.ts';
import { encrypt, facebookToken, read, write } from './store.ts';

/** Permissões sem as quais a Descoberta não funciona (business_management é opcional). */
const REQUIRED = ['instagram_basic', 'instagram_manage_insights', 'pages_show_list', 'pages_read_engagement'];

/** Para onde voltar depois do login: a página da conta (conectar) ou a Descoberta. */
type ReturnTo = 'conta' | 'descoberta';
const oauthStates = new Map<string, { accountId: string; returnTo: ReturnTo; expiresAt: number }>();

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
  if (!a) throw new DiscoveryError(404, 'Conta desconhecida.');
  return a.id;
}

/**
 * Conta do Instagram que faz as consultas: a própria, se estiver vinculada a uma Página;
 * senão, outra conta do dashboard que esteja. O limite de 30 hashtags conta para essa conta.
 */
export function discoveryConn(id: string): DiscoveryConn | null {
  const f = read().facebook;
  const token = facebookToken();
  if (!f || !token) return null;
  const via = f.linked[id] ? id : Object.keys(f.linked)[0];
  return via ? { igUserId: f.linked[via], token, viaAccountId: via } : null;
}

// ---------- OAuth do Facebook ----------

export const facebookCallback = express.Router();

facebookCallback.get('/facebook/callback', async (req, res) => {
  const { code, state, error_description } = req.query as Record<string, string | undefined>;
  const pending = state ? oauthStates.get(state) : undefined;
  if (state) oauthStates.delete(state);
  const back = (accountId: string | undefined, params: Record<string, string>) => {
    const page = !accountId ? '' : pending?.returnTo === 'conta' ? `conta/${accountId}` : `conta/${accountId}/descoberta`;
    res.redirect(`${config.frontendUrl}/${page}?${new URLSearchParams(params)}`);
  };

  if (!pending || pending.expiresAt < Date.now()) {
    return back(undefined, { error: 'Pedido de conexão expirado. Tente conectar de novo.' });
  }
  if (!code) return back(pending.accountId, { fbError: error_description ?? 'Conexão cancelada.' });

  try {
    const { token, expiresIn } = await fb.fbExchangeCode(code);
    const [me, { accounts: igAccounts, pagesWithoutInstagram }] = await Promise.all([fb.fbMe(token), fb.fbLinkedInstagram(token)]);
    const linked: Record<string, string> = {};
    for (const a of ACCOUNTS) {
      const found = igAccounts.find((i) => i.username.toLowerCase() === a.username.toLowerCase());
      if (found) linked[a.id] = found.igUserId;
    }
    const now = Date.now();
    const tokenEnc = encrypt(token);
    const connected: string[] = [];
    write((d) => {
      d.facebook = {
        name: me.name,
        tokenEnc,
        tokenIssuedAt: now,
        tokenExpiresAt: now + expiresIn * 1000,
        permissions: me.permissions,
        linked,
      };
      // Contas vinculadas a uma Página passam a sincronizar/publicar por este login, exceto as que já têm
      // conexão válida pelo login do Instagram (essa renova sozinha).
      for (const [accountId, igUserId] of Object.entries(linked)) {
        const c = d.connections[accountId];
        if (c && !c.via && c.tokenExpiresAt > now) continue;
        d.connections[accountId] = {
          igUserId,
          username: igAccounts.find((i) => i.igUserId === igUserId)!.username,
          tokenEnc,
          tokenIssuedAt: now,
          tokenExpiresAt: now + expiresIn * 1000,
          permissions: me.permissions,
          via: 'facebook',
        };
        connected.push(accountId);
      }
    });
    for (const id of connected) syncAccount(id).catch((e) => console.error('sync:', e));
    if (pending.returnTo === 'conta' && !linked[pending.accountId]) {
      const found = igAccounts.map((i) => '@' + i.username).join(', ') || 'nenhuma';
      const pages = pagesWithoutInstagram.length ? ` Páginas sem Instagram vinculado: ${pagesWithoutInstagram.join(', ')}.` : '';
      return back(pending.accountId, {
        error:
          `Login feito, mas esta conta não apareceu vinculada a uma Página sua. Contas do Instagram encontradas: ${found}.${pages}` +
          ' Vincule a conta profissional à Página (Instagram › Editar perfil › Página) e conecte de novo.',
      });
    }
    back(pending.accountId, pending.returnTo === 'conta' ? { connected: '1' } : { fb: '1' });
  } catch (e) {
    back(pending.accountId, { fbError: (e as Error).message });
  }
});

// ---------- Rotas com sessão ----------

export const discovery = express.Router();

discovery.get('/facebook/status', (_req, res) => {
  const f = read().facebook;
  res.json({
    missing: missingFacebookConfig(),
    redirectUri: fbRedirectUri(),
    connected: Boolean(f && f.tokenExpiresAt > Date.now()),
    name: f?.name ?? null,
    expiresAt: f?.tokenExpiresAt ?? null,
    missingPermissions: f ? REQUIRED.filter((p) => !f.permissions.includes(p)) : [],
    linked: ACCOUNTS.map((a) => ({ accountId: a.id, username: a.username, linked: Boolean(f?.linked[a.id]) })),
  });
});

discovery.post(
  '/facebook/connect',
  handle((req, res) => {
    const missing = missingFacebookConfig();
    if (missing.length) throw new DiscoveryError(400, `Configure no backend/.env: ${missing.join(', ')}`);
    const target = findAccount(String(req.body?.accountId ?? ''))?.id ?? ACCOUNTS[0].id;
    const returnTo: ReturnTo = req.body?.returnTo === 'conta' ? 'conta' : 'descoberta';
    const state = crypto.randomBytes(24).toString('base64url');
    oauthStates.set(state, { accountId: target, returnTo, expiresAt: Date.now() + 10 * 60 * 1000 });
    res.json({ url: fb.fbAuthorizeUrl(state) });
  }),
);

discovery.delete('/facebook/connection', (_req, res) => {
  write((d) => {
    delete d.facebook;
    for (const [id, c] of Object.entries(d.connections)) if (c.via === 'facebook') delete d.connections[id];
  });
  res.status(204).end();
});

discovery.get(
  '/accounts/:id/discovery/usage',
  handle((req, res) => {
    const conn = discoveryConn(accountId(req));
    res.json({ via: conn?.viaAccountId ?? null, usage: conn ? hashtagUsage(db, conn.viaAccountId) : null });
  }),
);

discovery.get(
  '/accounts/:id/discovery/search',
  handle(async (req, res) => {
    const id = accountId(req);
    res.json(await searchHashtag(db, fb.discoveryClient, discoveryConn(id), id, String(req.query.q ?? '')));
  }),
);

discovery.get(
  '/accounts/:id/discovery/suggestions',
  handle(async (req, res) => {
    const id = accountId(req);
    res.json(await suggestions(db, fb.discoveryClient, discoveryConn(id), id));
  }),
);

discovery.get(
  '/accounts/:id/discovery/profiles',
  handle((req, res) => {
    const id = accountId(req);
    const statuses = String(req.query.status ?? 'salvo,em_contato')
      .split(',')
      .filter((s): s is (typeof STATUSES)[number] => (STATUSES as readonly string[]).includes(s));
    res.json(listProfiles(db, id, { statuses, watch: true }));
  }),
);

discovery.post(
  '/accounts/:id/discovery/watchlist',
  handle(async (req, res) => {
    const id = accountId(req);
    res.status(201).json(await addToWatchlist(db, fb.discoveryClient, discoveryConn(id), id, String(req.body?.username ?? '')));
  }),
);

discovery.patch(
  '/discovery/:profileId',
  handle((req, res) => {
    res.json(updateProfile(db, Number(req.params.profileId), req.body ?? {}));
  }),
);

discovery.use((err: Error, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof DiscoveryError) return void res.status(err.status).json({ error: err.message });
  if (err instanceof InstagramError) return void res.status(502).json({ error: err.message.replace(/^Instagram:/, 'Meta:') });
  next(err);
});
