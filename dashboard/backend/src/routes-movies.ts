// Central de Filmes (contas com "hub": "filmes"). Exigem sessão (aplicada em server.ts).
import express, { type NextFunction, type Request, type Response } from 'express';
import { buildSystemPrompt, ClaudeError, completeClaude } from './claude.ts';
import { findAccount } from './config.ts';
import { db } from './db.ts';
import { GEN_KINDS, defaultDeps, runningJob, startPlannedGeneration, type GenDeps, type GenKind } from './generate.ts';
import { HUB_MAX_POSTS, MOVIE_HUB, findOption, headlines, movieBrief, parsePlan, planPrompt, type HubRow } from './movies.ts';

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

function hubAccount(req: Request) {
  const a = findAccount(req.params.id as string);
  if (!a) throw new HttpError(404, 'Conta desconhecida.');
  if (a.hub !== 'filmes') throw new HttpError(404, 'Esta conta não tem a Central de Filmes ("hub": "filmes" no arquivo de contas).');
  return a;
}

export interface MovieDeps {
  claude: (system: string, user: string) => Promise<string>;
  fetcher: (url: string) => Promise<string>;
  gen: GenDeps;
}

const fetchText = async (url: string) => {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (painel de conteúdo; leitura de RSS)' }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
};

const defaultMovieDeps = (): MovieDeps => ({
  claude: (system, user) => completeClaude(system, user, { wait: true }),
  fetcher: fetchText,
  gen: defaultDeps(),
});

/** Valida as linhas da tela: menu/opção existentes, formato, quantidade e total. */
export function parseRows(body: unknown): HubRow[] {
  const raw = Array.isArray((body as { rows?: unknown })?.rows) ? ((body as { rows: unknown[] }).rows as Record<string, unknown>[]) : [];
  const rows = raw
    .map((r) => ({
      group: String(r?.group ?? ''),
      option: String(r?.option ?? ''),
      kind: String(r?.kind ?? '') as GenKind,
      qty: Math.floor(Number(r?.qty) || 0),
      extra: typeof r?.extra === 'string' ? r.extra.trim().slice(0, 300) : '',
    }))
    .filter((r) => r.qty > 0);
  if (!rows.length) throw new HttpError(400, 'Indique a quantidade de pelo menos uma linha.');
  for (const r of rows) {
    if (!findOption(r.group, r.option)) throw new HttpError(400, `Opção inválida: ${r.group} › ${r.option}.`);
    if (!(GEN_KINDS as readonly string[]).includes(r.kind)) throw new HttpError(400, `Formato inválido: ${r.kind}.`);
  }
  const total = rows.reduce((a, r) => a + r.qty, 0);
  if (total > HUB_MAX_POSTS) throw new HttpError(400, `No máximo ${HUB_MAX_POSTS} posts por vez (pedido: ${total}).`);
  return rows;
}

/** `deps` é trocado nos testes por dublês (Claude, Google Notícias, gerador). */
export function movieRoutes(deps: () => MovieDeps = defaultMovieDeps) {
  const r = express.Router();

  r.get(
    '/accounts/:id/filmes/catalogo',
    handle((req, res) => {
      hubAccount(req);
      res.json({ groups: MOVIE_HUB.map((g) => ({ ...g, options: g.options.map(({ id, label, query, extra }) => ({ id, label, current: Boolean(query), extra })) })), maxPosts: HUB_MAX_POSTS });
    }),
  );

  /** Planeja os títulos de cada linha (Claude + manchetes) e gera os rascunhos, tudo em segundo plano. */
  r.post(
    '/accounts/:id/filmes/gerar',
    handle((req, res) => {
      const a = hubAccount(req);
      const rows = parseRows(req.body);
      if (runningJob(a.id)) throw new HttpError(409, 'Já existe uma geração em andamento nesta conta. Aguarde terminar.');
      const d = deps();
      const today = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
      const plan = async () => {
        const system = buildSystemPrompt(db, { account: a, artifact: 'ideias', instruction: '' });
        const requests: { theme: string; kind: GenKind; brief: string }[] = [];
        const taken: string[] = [];
        for (const row of rows) {
          const { group, option } = findOption(row.group, row.option)!;
          const news = option.query ? await headlines(option.query, d.fetcher) : [];
          const subjects = parsePlan(await d.claude(system, planPrompt(group, option, row, news, taken, today)), row.qty);
          if (!subjects.length) throw new Error(`O Claude não sugeriu títulos para "${option.label}". Tente de novo.`);
          for (const s of subjects) {
            taken.push(s.title);
            requests.push({ theme: s.title, kind: row.kind, brief: movieBrief(group, option, s, news) });
          }
        }
        return requests;
      };
      res.status(202).json(startPlannedGeneration(db, a, plan, { rewrite: req.body?.rewrite !== false, media: false }, d.gen));
    }),
  );

  r.use((err: Error, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof HttpError) return void res.status(err.status).json({ error: err.message });
    if (err instanceof ClaudeError) return void res.status(503).json({ error: err.message });
    next(err);
  });
  return r;
}
