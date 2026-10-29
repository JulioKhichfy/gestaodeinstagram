// Gerador de posts em lote e mídia do banco de imagens (Pixabay/Pexels). Exigem sessão do dashboard (aplicada em server.ts).
import { Readable } from 'node:stream';
import express, { type NextFunction, type Request, type Response } from 'express';
import { findAccount } from './config.ts';
import { db } from './db.ts';
import {
  GENERATE_MAX_ITEMS,
  GEN_KINDS,
  MAX_REWRITES,
  TARGET_GRADE,
  defaultDeps,
  getJob,
  runningJob,
  startGeneration,
  type GenDeps,
  type GenKind,
} from './generate.ts';
import { jevConfigured } from './jev.ts';
import { PROVIDER_LABELS, STOCK_HOSTS, isUnsplashTrack, stockConfigured, stockProviders, trackUnsplash, type StockItem } from './stock.ts';

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

/** Vídeo de banco para Reels: bem abaixo do limite do Instagram, mas evita baixar arquivos enormes. */
const MAX_DOWNLOAD = 200 * 1024 * 1024;

/** `deps` é trocado nos testes por dublês do Claude, do Jev e do Pexels. */
export function generateRoutes(deps: () => GenDeps = defaultDeps) {
  const r = express.Router();

  r.get('/generate/status', (_req, res) => {
    const labels = stockProviders().map((p) => PROVIDER_LABELS[p]);
    res.json({ jev: jevConfigured(), stock: stockConfigured(), stockLabel: labels.length ? labels.join(', ') : null, maxItems: GENERATE_MAX_ITEMS, target: TARGET_GRADE, maxRewrites: MAX_REWRITES });
  });

  r.post(
    '/accounts/:id/generate',
    handle((req, res) => {
      const account = findAccount(req.params.id as string);
      if (!account) throw new HttpError(404, 'Conta desconhecida.');
      if (runningJob(account.id)) throw new HttpError(409, 'Já existe uma geração em andamento nesta conta. Aguarde terminar.');
      const b = req.body ?? {};
      const items = (Array.isArray(b.items) ? b.items : [])
        .map((i: { theme?: unknown; kind?: unknown }) => ({
          theme: typeof i?.theme === 'string' ? i.theme.trim().slice(0, 500) : '',
          kind: (GEN_KINDS as readonly string[]).includes(String(i?.kind)) ? (i.kind as GenKind) : 'image',
        }))
        .filter((i: { theme: string }) => i.theme);
      if (!items.length) throw new HttpError(400, 'Escreva o tema de pelo menos um post.');
      if (items.length > GENERATE_MAX_ITEMS) throw new HttpError(400, `No máximo ${GENERATE_MAX_ITEMS} posts por vez.`);
      const job = startGeneration(db, account, items, { rewrite: b.rewrite !== false, media: b.media !== false }, deps());
      res.status(202).json(job);
    }),
  );

  r.get(
    '/generate/:jobId',
    handle((req, res) => {
      const job = getJob(req.params.jobId as string);
      if (!job) throw new HttpError(404, 'Geração não encontrada (o backend pode ter reiniciado).');
      res.json(job);
    }),
  );

  /** Troca quais mídias sugeridas vão para o post (ids entre as sugeridas do rascunho). */
  r.put(
    '/drafts/:did/media',
    handle((req, res) => {
      const d = db.prepare('SELECT id, media FROM drafts WHERE id = ?').get(Number(req.params.did)) as
        | { id: number; media: string }
        | undefined;
      if (!d) throw new HttpError(404, 'Rascunho não encontrado.');
      const chosen = new Set((Array.isArray(req.body?.selected) ? req.body.selected : []).map(String));
      const media = (JSON.parse(d.media) as StockItem[]).map((m) => ({ ...m, selected: chosen.has(m.id) }));
      db.prepare('UPDATE drafts SET media = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(media), Date.now(), d.id);
      res.json(media);
    }),
  );

  /**
   * Baixa um vídeo ou foto do banco de imagens para o editor de publicação (o navegador não baixa direto por causa
   * de CORS). Só aceita os hosts do Pixabay e do Pexels: não é um proxy aberto.
   */
  r.get(
    '/stock/file',
    handle(async (req, res) => {
      let url: URL;
      try {
        url = new URL(String(req.query.url ?? ''));
      } catch {
        throw new HttpError(400, 'Endereço inválido.');
      }
      if (url.protocol !== 'https:' || !STOCK_HOSTS.has(url.hostname)) throw new HttpError(400, 'Só é possível baixar mídia dos bancos de imagens (Unsplash, Pixabay ou Pexels).');
      const upstream = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      const type = upstream.headers.get('content-type') ?? '';
      if (!upstream.ok || !upstream.body) throw new HttpError(502, `Banco de imagens: não consegui baixar a mídia (${upstream.status}).`);
      if (!/^(image|video)\//.test(type)) throw new HttpError(502, 'O banco de imagens devolveu um arquivo que não é foto nem vídeo.');
      const size = Number(upstream.headers.get('content-length') ?? 0);
      if (size > MAX_DOWNLOAD) throw new HttpError(413, 'Vídeo grande demais. Escolha outro.');
      res.setHeader('Content-Type', type);
      if (size) res.setHeader('Content-Length', String(size));
      Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream).pipe(res);
    }),
  );

  /** Unsplash: avisa que a foto foi baixada para um post (regra da API deles). */
  r.post(
    '/stock/track',
    handle(async (req, res) => {
      const url = String(req.body?.url ?? '');
      if (!isUnsplashTrack(url)) throw new HttpError(400, 'Endereço de aviso inválido.');
      await trackUnsplash(url);
      res.status(204).end();
    }),
  );

  r.use((err: Error, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof HttpError) return void res.status(err.status).json({ error: err.message });
    next(err);
  });
  return r;
}
