import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import * as auth from './auth.ts';
import { ACCOUNTS, config, findAccount, missingConfig, publishMissing, redirectUri, setupMissing } from './config.ts';
import * as ig from './instagram.ts';
import { db } from './db.ts';
import type { PublishRequest } from './publish.ts';
import { discovery, facebookCallback } from './routes-discovery.ts';
import { generateRoutes } from './routes-generate.ts';
import { jevRoutes } from './routes-jev.ts';
import { leadsRoutes } from './routes-leads.ts';
import { movieRoutes } from './routes-movies.ts';
import { radarRoutes } from './routes-radar.ts';
import { scheduleRoutes } from './routes-schedule.ts';
import { PublishError, publishFor } from './schedule.ts';
import { v2 } from './routes-v2.ts';
import { isSyncing, syncAccount } from './sync.ts';
import { connectionAuth, encrypt, read, write } from './store.ts';

fs.mkdirSync(config.mediaDir, { recursive: true });

const app = express();
// O túnel (ngrok) chega pelo loopback; confia no X-Forwarded-For só dele.
app.set('trust proxy', 'loopback');
app.use(express.json());

// Mídia precisa ser pública: o Instagram baixa daqui na hora de publicar.
app.use('/media', express.static(config.mediaDir, { index: false, dotfiles: 'deny' }));

const api = express.Router();
app.use('/api', api);

// Para testar o túnel: abra PUBLIC_BASE_URL/api/health no navegador.
api.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// ---------- Sessão do dashboard ----------

api.get('/session/status', (_req, res) => {
  res.json({ hasPassword: auth.hasPassword() });
});

api.post('/session/setup', (req, res) => {
  if (auth.hasPassword()) return void res.status(409).json({ error: 'A senha já foi criada.' });
  const { password, remember } = req.body ?? {};
  if (typeof password !== 'string' || password.length < 8) {
    return void res.status(400).json({ error: 'A senha precisa ter ao menos 8 caracteres.' });
  }
  auth.setPassword(password);
  res.json(auth.createSession(Boolean(remember)));
});

api.post('/session/login', (req, res) => {
  const ip = req.ip ?? 'unknown';
  if (auth.loginBlocked(ip)) {
    return void res.status(429).json({ error: 'Muitas tentativas. Aguarde 15 minutos.' });
  }
  const { password, remember } = req.body ?? {};
  if (typeof password !== 'string' || !auth.checkPassword(password)) {
    auth.registerLoginFailure(ip);
    return void res.status(401).json({ error: 'Senha incorreta.' });
  }
  auth.clearLoginFailures(ip);
  res.json(auth.createSession(Boolean(remember)));
});

api.post('/session/logout', auth.requireSession, (req, res) => {
  auth.destroySession(auth.bearer(req)!);
  res.status(204).end();
});

// ---------- OAuth do Instagram ----------

const oauthStates = new Map<string, { accountId: string; expiresAt: number }>();

api.post('/accounts/:id/connect', auth.requireSession, (req, res) => {
  const account = findAccount(req.params.id as string);
  if (!account) return void res.status(404).json({ error: 'Conta desconhecida.' });
  const missing = missingConfig();
  if (missing.length) {
    return void res.status(400).json({ error: `Configure no backend/.env: ${missing.join(', ')}` });
  }
  const state = crypto.randomBytes(24).toString('base64url');
  oauthStates.set(state, { accountId: account.id, expiresAt: Date.now() + 10 * 60 * 1000 });
  res.json({ url: ig.authorizeUrl(state) });
});

function saveConnection(accountId: string, profile: ig.Profile, token: string, expiresIn: number, permissions: string[]): void {
  write((d) => {
    d.connections[accountId] = {
      igUserId: profile.user_id,
      username: profile.username,
      tokenEnc: encrypt(token),
      tokenIssuedAt: Date.now(),
      tokenExpiresAt: Date.now() + expiresIn * 1000,
      permissions,
    };
  });
  syncAccount(accountId).catch((e) => console.error('sync:', e));
}

/**
 * Conexão sem túnel (teste local): token gerado no painel da Meta (Instagram > Configuração da API com login
 * do Instagram > Gerar token). Esses tokens já são de longa duração (60 dias) e trazem as permissões do caso
 * de uso do app. O token chega uma vez, é conferido no Instagram e guardado criptografado; nunca volta ao navegador.
 */
api.post('/accounts/:id/token', auth.requireSession, async (req, res) => {
  const account = findAccount(req.params.id as string);
  if (!account) return void res.status(404).json({ error: 'Conta desconhecida.' });
  const token = String(req.body?.token ?? '').trim();
  if (!/^[A-Za-z0-9_\-|.]{40,600}$/.test(token)) return void res.status(400).json({ error: 'Token inválido: cole o token inteiro gerado no painel da Meta.' });
  try {
    const profile = await ig.getProfile({ token, via: 'instagram' });
    if (profile.username.toLowerCase() !== account.username.toLowerCase()) {
      return void res.status(400).json({ error: `Este token é da @${profile.username}, mas esta aba é da @${account.username}.` });
    }
    saveConnection(account.id, profile, token, 60 * 86_400, ig.SCOPES);
    res.json({ ok: true, username: profile.username });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

api.get('/instagram/callback', async (req, res) => {
  const { code, state, error_description } = req.query as Record<string, string | undefined>;
  const pending = state ? oauthStates.get(state) : undefined;
  if (state) oauthStates.delete(state);

  const back = (accountId: string | undefined, params: Record<string, string>) =>
    res.redirect(`${config.frontendUrl}/${accountId ? `conta/${accountId}` : ''}?${new URLSearchParams(params)}`);

  if (!pending || pending.expiresAt < Date.now()) {
    return back(undefined, { error: 'Pedido de conexão expirado. Tente conectar de novo.' });
  }
  const account = findAccount(pending.accountId)!;
  if (!code) return back(account.id, { error: error_description ?? 'Conexão cancelada.' });

  try {
    const { token, expiresIn, permissions } = await ig.exchangeCode(code);
    const profile = await ig.getProfile({ token, via: 'instagram' });
    if (profile.username.toLowerCase() !== account.username.toLowerCase()) {
      return back(account.id, {
        error: `Você entrou como @${profile.username}, mas esta aba é da @${account.username}. Saia do Instagram no navegador e tente de novo.`,
      });
    }
    saveConnection(account.id, profile, token, expiresIn, permissions);
    back(account.id, { connected: '1' });
  } catch (e) {
    back(account.id, { error: (e as Error).message });
  }
});

api.delete('/accounts/:id/connection', auth.requireSession, (req, res) => {
  write((d) => {
    delete d.connections[req.params.id as string];
  });
  res.status(204).end();
});

// ---------- Contas ----------

api.get('/config', auth.requireSession, (_req, res) => {
  res.json({
    missing: setupMissing(),
    publishMissing: publishMissing(),
    instagramLogin: missingConfig().length === 0,
    redirectUri: redirectUri(),
    publicBaseUrl: config.publicBaseUrl,
  });
});

api.get('/accounts', auth.requireSession, (_req, res) => {
  const { connections } = read();
  res.json(
    ACCOUNTS.map((a) => {
      const c = connections[a.id];
      return {
        ...a,
        connected: Boolean(c) && c.tokenExpiresAt > Date.now(),
        tokenExpiresAt: c?.tokenExpiresAt ?? null,
        // Conexões feitas na v1 não pediram a permissão de métricas: precisam reconectar.
        hasInsights: Boolean(c?.permissions?.some((p) => p === ig.INSIGHTS_SCOPE || p === 'instagram_manage_insights')),
        via: c?.via ?? (c ? 'instagram' : null),
        syncing: isSyncing(a.id),
      };
    }),
  );
});

/** Resolve conta conectada + token, ou responde erro. */
function connected(req: Request, res: Response) {
  const id = req.params.id as string;
  const c = read().connections[id];
  if (!findAccount(id)) return void res.status(404).json({ error: 'Conta desconhecida.' });
  if (!c || c.tokenExpiresAt < Date.now()) {
    return void res.status(409).json({ error: 'Conta não conectada. Clique em "Conectar Instagram".' });
  }
  return { igUserId: c.igUserId, auth: connectionAuth(id)! };
}

const handle =
  (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

api.get(
  '/accounts/:id/overview',
  auth.requireSession,
  handle(async (req, res) => {
    const conn = connected(req, res);
    if (!conn) return;
    const [profile, limit] = await Promise.all([
      ig.getProfile(conn.auth, conn.igUserId),
      ig.getPublishingLimit(conn.igUserId, conn.auth).catch(() => null),
    ]);
    res.json({ profile, limit });
  }),
);

api.get(
  '/accounts/:id/media',
  auth.requireSession,
  handle(async (req, res) => {
    const conn = connected(req, res);
    if (!conn) return;
    res.json(await ig.getRecentMedia(conn.igUserId, conn.auth));
  }),
);

// ---------- Upload de mídia e publicação ----------

const ALLOWED_UPLOAD = new Set(['.jpg', '.jpeg', '.mp4', '.mov']);

const upload = multer({
  storage: multer.diskStorage({
    destination: config.mediaDir,
    filename: (_req, file, cb) =>
      cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 1024 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, ALLOWED_UPLOAD.has(path.extname(file.originalname).toLowerCase())),
});

api.post('/media', auth.requireSession, upload.single('file'), (req, res) => {
  if (!req.file) return void res.status(400).json({ error: 'Envie um arquivo JPEG, MP4 ou MOV.' });
  res.json({ file: req.file.filename });
});

api.delete('/media/:file', auth.requireSession, (req, res) => {
  const file = path.basename(req.params.file as string);
  fs.rm(path.join(config.mediaDir, file), { force: true }, () => res.status(204).end());
});

api.post(
  '/accounts/:id/publish',
  auth.requireSession,
  handle(async (req, res) => {
    if (!findAccount(req.params.id as string)) return void res.status(404).json({ error: 'Conta desconhecida.' });
    try {
      res.json(await publishFor(db, req.params.id as string, req.body as PublishRequest));
    } catch (e) {
      if (e instanceof PublishError) return void res.status(e.status).json({ error: e.message });
      throw e;
    }
  }),
);

// Descoberta de perfis (v3): a volta do login do Facebook é pública; o resto exige sessão.
api.use(facebookCallback);
api.use(auth.requireSession, discovery);
api.use(auth.requireSession, jevRoutes());
api.use(auth.requireSession, generateRoutes());
api.use(auth.requireSession, leadsRoutes());
api.use(auth.requireSession, radarRoutes());
api.use(auth.requireSession, movieRoutes());
api.use(auth.requireSession, scheduleRoutes());

// Rotas da versão 2 (relatórios, experimentos, ciclos, rascunhos, Claude, tráfego pago).
api.use(auth.requireSession, v2);

api.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  const status = err instanceof ig.InstagramError ? 502 : 500;
  res.status(status).json({ error: err.message || 'Erro inesperado.' });
});


export { app };
