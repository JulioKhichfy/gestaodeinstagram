// Estúdio (edição de vídeo e imagem). Exigem sessão (aplicada em server.ts).
import { spawn } from 'node:child_process';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { ClaudeError, completeClaude } from './claude.ts';
import {
  OUTPUT_FOLDER,
  STUDIO_SYSTEM,
  StudioError,
  WHISPER_MODELS,
  capabilities,
  downloadModel,
  getStudioJob,
  knownOutDirs,
  modelDownload,
  parsePlan,
  planPrompt,
  scan,
  startPlan,
  storePlan,
} from './studio.ts';

const handle =
  (fn: (req: Request, res: Response) => Promise<void> | void) => (req: Request, res: Response, next: NextFunction) => {
    try {
      Promise.resolve(fn(req, res)).catch(next);
    } catch (e) {
      next(e);
    }
  };

const strings = (v: unknown, max = 60) => (Array.isArray(v) ? v.map(String).filter((s) => s.trim()).slice(0, max) : []);

/** `ai` é trocado nos testes por um dublê (a IA que planeja). */
export function studioRoutes(ai: (system: string, user: string) => Promise<string> = (s, u) => completeClaude(s, u, { wait: true })) {
  const r = express.Router();

  r.get(
    '/estudio/capacidades',
    handle(async (req, res) => {
      res.json({ ...(await capabilities(req.query.atualizar === '1')), modelos: WHISPER_MODELS, download: { base: modelDownload('base'), small: modelDownload('small') } });
    }),
  );

  /** Lista as mídias das pastas ou arquivos colados. */
  r.post(
    '/estudio/arquivos',
    handle(async (req, res) => {
      const paths = strings(req.body?.paths, 20);
      if (!paths.length) throw new StudioError(400, 'Cole pelo menos um caminho de pasta ou arquivo.');
      res.json(await scan(paths));
    }),
  );

  /** A IA monta o plano; o servidor valida e guarda. Nada é executado aqui. */
  r.post(
    '/estudio/planejar',
    handle(async (req, res) => {
      const pedido = String(req.body?.pedido ?? '').trim().slice(0, 4000);
      if (!pedido) throw new StudioError(400, 'Escreva o que quer fazer com os arquivos.');
      const chosen = strings(req.body?.arquivos);
      if (!chosen.length) throw new StudioError(400, 'Escolha pelo menos um arquivo.');
      const { files, errors } = await scan(chosen);
      if (errors.length || files.length !== chosen.length) throw new StudioError(400, errors[0] ?? 'Algum arquivo escolhido não foi encontrado.');
      const caps = await capabilities();
      if (!caps.ffmpeg) throw new StudioError(409, 'O FFmpeg não está instalado. No PowerShell: winget install -e --id Gyan.FFmpeg (depois feche e abra o dashboard).');
      const outDir = path.join(path.dirname(files[0].path), OUTPUT_FOLDER);
      const plan = parsePlan(await ai(STUDIO_SYSTEM, planPrompt(files, outDir, caps, pedido)));
      const { id, problems } = storePlan(plan, { inputs: files.map((f) => f.path), outDir });
      res.json({ id, plan, outDir, problems });
    }),
  );

  r.post(
    '/estudio/executar',
    handle((req, res) => {
      res.status(202).json(startPlan(String(req.body?.planId ?? '')));
    }),
  );

  r.get(
    '/estudio/trabalhos/:id',
    handle((req, res) => {
      const job = getStudioJob(req.params.id as string);
      if (!job) throw new StudioError(404, 'Trabalho não encontrado.');
      res.json(job);
    }),
  );

  /** Baixa o modelo da legenda automática (só se o FFmpeg tiver o filtro whisper). */
  r.post(
    '/estudio/modelo',
    handle(async (req, res) => {
      if (!(await capabilities()).whisper) throw new StudioError(409, 'Este FFmpeg não tem o filtro de legenda automática (whisper).');
      downloadModel(String(req.body?.tamanho ?? 'small'));
      res.status(202).json({ ok: true });
    }),
  );

  /** Abre a pasta "editados" no Explorador de Arquivos (só pastas de trabalhos do Estúdio). */
  r.post(
    '/estudio/abrir',
    handle((req, res) => {
      const dir = path.resolve(String(req.body?.path ?? ''));
      if (!knownOutDirs().has(dir.toLowerCase())) throw new StudioError(400, 'Só dá para abrir as pastas de saída do Estúdio.');
      if (process.platform !== 'win32') throw new StudioError(400, 'Abrir pasta funciona só no Windows.');
      spawn('explorer.exe', [dir], { detached: true, stdio: 'ignore' }).unref();
      res.status(204).end();
    }),
  );

  r.use((err: Error, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof StudioError) return void res.status(err.status).json({ error: err.message });
    if (err instanceof ClaudeError) return void res.status(503).json({ error: err.message });
    next(err);
  });
  return r;
}
