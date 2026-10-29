// Radar de assuntos e Raio-X (contas com `radar` no arquivo de contas). Exigem sessão (aplicada em server.ts).
import express, { type NextFunction, type Request, type Response } from 'express';
import { buildSystemPrompt, ClaudeError, completeClaude } from './claude.ts';
import { findAccount } from './config.ts';
import { db } from './db.ts';
import { GEN_KINDS, defaultDeps, runningJob, startGeneration, type GenDeps, type GenKind } from './generate.ts';
import { jevClient, jevConfigured, type JevClient } from './jev.ts';
import {
  DEFAULT_SERIES,
  clusters,
  historyBrief,
  lastRadarRefresh,
  linkGeneration,
  newsBrief,
  refreshRadar,
  resolveDrafts,
  setClusterStatus,
  suggestPautas,
} from './radar.ts';

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const handle =
  (fn: (req: Request, res: Response) => Promise<void> | void) => (req: Request, res: Response, next: NextFunction) => {
    try {
      Promise.resolve(fn(req, res)).catch(next);
    } catch (e) {
      next(e);
    }
  };

function radarAccount(req: Request) {
  const a = findAccount(req.params.id as string);
  if (!a) throw new HttpError(404, 'Conta desconhecida.');
  if (!a.radar) throw new HttpError(404, 'Esta conta não tem Radar configurado (campo "radar" no arquivo de contas).');
  return a;
}

const kindOf = (v: unknown): GenKind => ((GEN_KINDS as readonly string[]).includes(String(v)) ? (v as GenKind) : 'image');

export interface RadarDeps {
  jev: JevClient | null;
  fetcher?: (url: string) => Promise<string>;
  gen: GenDeps;
  claude: (system: string, user: string) => Promise<string>;
}

const defaultRadarDeps = (): RadarDeps => ({
  jev: jevConfigured() ? jevClient : null,
  gen: defaultDeps(),
  claude: (system, user) => completeClaude(system, user),
});

/** `deps` é trocado nos testes por dublês (fontes, Jev, Claude). */
export function radarRoutes(deps: () => RadarDeps = defaultRadarDeps) {
  const r = express.Router();

  r.get(
    '/accounts/:id/radar',
    handle((req, res) => {
      const a = radarAccount(req);
      const list = resolveDrafts(db, clusters(db, a.radar!, a.id)).filter((c) => req.query.all === '1' || c.status !== 'ignorado');
      res.json({
        topic: a.radar!.topic,
        feeds: a.radar!.feeds.map((f) => f.name),
        lastRefresh: lastRadarRefresh(a.id),
        jev: jevConfigured(),
        clusters: list,
      });
    }),
  );

  r.post(
    '/accounts/:id/radar/refresh',
    handle(async (req, res) => {
      const a = radarAccount(req);
      const d = deps();
      res.json(await refreshRadar(db, a, d.jev, d.fetcher));
    }),
  );

  r.patch(
    '/accounts/:id/radar/:clusterId',
    handle((req, res) => {
      radarAccount(req);
      const status = req.body?.status;
      if (status !== 'novo' && status !== 'ignorado') throw new HttpError(400, 'Status inválido.');
      setClusterStatus(db, req.params.clusterId as string, status);
      res.status(204).end();
    }),
  );

  /** Cria o rascunho de um post a partir da notícia (Claude escreve com outras palavras, Jev revisa). */
  r.post(
    '/accounts/:id/radar/:clusterId/post',
    handle((req, res) => {
      const a = radarAccount(req);
      const c = clusters(db, a.radar!, a.id).find((x) => x.id === req.params.clusterId);
      if (!c) throw new HttpError(404, 'Notícia não encontrada (pode ter saído da janela de 48 h).');
      if (runningJob(a.id)) throw new HttpError(409, 'Já existe uma geração em andamento nesta conta. Aguarde terminar.');
      const job = startGeneration(db, a, [{ theme: c.title, kind: kindOf(req.body?.kind), brief: newsBrief(c) }], { rewrite: true, media: false }, deps().gen);
      linkGeneration(db, c.id, job.id);
      res.status(202).json(job);
    }),
  );

  r.get(
    '/accounts/:id/radar/series',
    handle((req, res) => {
      const a = radarAccount(req);
      res.json(a.radar!.series?.length ? a.radar!.series : DEFAULT_SERIES);
    }),
  );

  /** Raio-X: pautas sugeridas pelo Claude para uma série. */
  r.post(
    '/accounts/:id/radar/pautas',
    handle(async (req, res) => {
      const a = radarAccount(req);
      const serie = String(req.body?.serie ?? '').trim().slice(0, 200);
      if (!serie) throw new HttpError(400, 'Escolha uma série.');
      const system = buildSystemPrompt(db, { account: a, artifact: 'ideias', instruction: '' });
      res.json(await suggestPautas(a, serie, (user) => deps().claude(system, user)));
    }),
  );

  /** Raio-X: gera os posts das pautas escolhidas, com as regras de conteúdo histórico. */
  r.post(
    '/accounts/:id/radar/pautas/generate',
    handle((req, res) => {
      const a = radarAccount(req);
      const serie = String(req.body?.serie ?? '').slice(0, 200);
      const items = (Array.isArray(req.body?.items) ? req.body.items : [])
        .map((i: { theme?: unknown; kind?: unknown }) => ({ theme: String(i?.theme ?? '').trim().slice(0, 300), kind: kindOf(i?.kind) }))
        .filter((i: { theme: string }) => i.theme)
        .slice(0, 10);
      if (!items.length) throw new HttpError(400, 'Escolha pelo menos uma pauta.');
      if (runningJob(a.id)) throw new HttpError(409, 'Já existe uma geração em andamento nesta conta. Aguarde terminar.');
      const brief = historyBrief(a.radar!.topic, serie);
      const job = startGeneration(
        db,
        a,
        items.map((i: { theme: string; kind: GenKind }) => ({ ...i, brief })),
        { rewrite: true, media: Boolean(req.body?.media) },
        deps().gen,
      );
      res.status(202).json(job);
    }),
  );

  r.use((err: Error, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof HttpError) return void res.status(err.status).json({ error: err.message });
    if (err instanceof ClaudeError) return void res.status(503).json({ error: err.message });
    next(err);
  });
  return r;
}
