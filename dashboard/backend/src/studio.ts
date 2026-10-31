// Estúdio: editar vídeos e imagens pelo dashboard, sem VS Code. A IA (Claude ou ChatGPT, pela assinatura) só PLANEJA
// os comandos do FFmpeg; o dashboard valida o plano (só o FFmpeg, só as pastas escolhidas, saída sempre em
// "editados", nunca sobrescreve) e executa depois que a pessoa confere e clica em Executar.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';

export const VIDEO_EXT = ['.mp4', '.mov', '.m4v', '.mkv', '.avi', '.webm'];
export const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp'];
export const AUDIO_EXT = ['.mp3', '.wav', '.m4a', '.aac', '.ogg'];
export const SUB_EXT = ['.srt', '.ass', '.vtt'];
const OUTPUT_EXT = new Set([...VIDEO_EXT, ...IMAGE_EXT, ...AUDIO_EXT, ...SUB_EXT, '.txt']);
const TEXT_EXT = new Set(['.srt', '.ass', '.vtt', '.txt']);
export const OUTPUT_FOLDER = 'editados';
const MAX_FILES = 60;
export const MAX_STEPS = 12;
const STEP_TIMEOUT = 60 * 60 * 1000;

export class StudioError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export type MediaKind = 'video' | 'imagem' | 'audio' | 'legenda';

export interface MediaFile {
  path: string;
  name: string;
  kind: MediaKind;
  size: number;
  duration?: number;
  width?: number;
  height?: number;
  audio?: boolean;
}

export const modelsDir = () => path.join(config.dataDir, 'modelos');
const fontsDir = () => path.join(process.env.WINDIR ?? 'C:\\Windows', 'Fonts');

function kindOf(file: string): MediaKind | null {
  const ext = path.extname(file).toLowerCase();
  if (VIDEO_EXT.includes(ext)) return 'video';
  if (IMAGE_EXT.includes(ext)) return 'imagem';
  if (AUDIO_EXT.includes(ext)) return 'audio';
  if (SUB_EXT.includes(ext)) return 'legenda';
  return null;
}

// ---------- Processos (sem shell: os argumentos vão direto para o FFmpeg) ----------

/** Linha de comando do executável: aceita "ffmpeg" ou "node C:\caminho\falso.mjs" (testes). */
function splitBin(bin: string): [string, string[]] {
  const parts = bin.match(/"[^"]+"|\S+/g) ?? [bin];
  const clean = parts.map((p) => p.replace(/^"|"$/g, ''));
  return [clean[0], clean.slice(1)];
}

export function runProcess(
  bin: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const [cmd, pre] = splitBin(bin);
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, [...pre, ...args], { cwd: opts.cwd, windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill(), opts.timeoutMs ?? 60_000);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => {
      stderr += d;
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

// ---------- O que o FFmpeg instalado sabe fazer ----------

export interface Capabilities {
  ffmpeg: string | null;
  whisper: boolean;
  subtitles: boolean;
  drawtext: boolean;
  models: string[];
}

let capsCache: { at: number; caps: Capabilities } | null = null;

export async function capabilities(force = false): Promise<Capabilities> {
  if (!force && capsCache && Date.now() - capsCache.at < 60_000) return capsCache.caps;
  const models = fs.existsSync(modelsDir()) ? fs.readdirSync(modelsDir()).filter((f) => /^ggml-.*\.bin$/.test(f)) : [];
  let caps: Capabilities = { ffmpeg: null, whisper: false, subtitles: false, drawtext: false, models };
  try {
    const v = await runProcess(config.ffmpegBin, ['-hide_banner', '-version']);
    const f = await runProcess(config.ffmpegBin, ['-hide_banner', '-filters']);
    const has = (name: string) => new RegExp(`\\s${name}\\s`).test(f.stdout);
    caps = { ffmpeg: v.stdout.split('\n')[0].trim() || 'ffmpeg', whisper: has('whisper'), subtitles: has('subtitles'), drawtext: has('drawtext'), models };
  } catch {
    // FFmpeg não instalado
  }
  capsCache = { at: Date.now(), caps };
  return caps;
}

// ---------- Arquivos escolhidos ----------

async function probe(file: string): Promise<Partial<MediaFile>> {
  try {
    const r = await runProcess(config.ffprobeBin, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { timeoutMs: 30_000 });
    const data = JSON.parse(r.stdout) as { format?: { duration?: string }; streams?: { codec_type: string; width?: number; height?: number }[] };
    const video = data.streams?.find((s) => s.codec_type === 'video');
    const duration = Number(data.format?.duration);
    return {
      duration: Number.isFinite(duration) && duration > 0 ? Math.round(duration * 10) / 10 : undefined,
      width: video?.width,
      height: video?.height,
      audio: Boolean(data.streams?.some((s) => s.codec_type === 'audio')),
    };
  } catch {
    return {};
  }
}

/** Caminhos colados pela pessoa (pastas ou arquivos) -> mídias encontradas, com duração e tamanho. */
export async function scan(paths: string[]): Promise<{ files: MediaFile[]; errors: string[] }> {
  const errors: string[] = [];
  const found: string[] = [];
  for (const raw of paths) {
    const p = raw.trim().replace(/^"|"$/g, '');
    if (!p) continue;
    if (!path.isAbsolute(p)) {
      errors.push(`"${p}": use o caminho completo (ex.: C:\\Users\\voce\\Videos).`);
      continue;
    }
    if (!fs.existsSync(p)) {
      errors.push(`"${p}": não encontrado.`);
      continue;
    }
    if (fs.statSync(p).isDirectory()) {
      for (const f of fs.readdirSync(p)) {
        const full = path.join(p, f);
        if (kindOf(f) && fs.statSync(full).isFile()) found.push(full);
      }
    } else if (kindOf(p)) found.push(p);
    else errors.push(`"${path.basename(p)}": tipo de arquivo não suportado.`);
  }
  const unique = [...new Set(found.map((f) => path.resolve(f)))].slice(0, MAX_FILES);
  if (found.length > MAX_FILES) errors.push(`Mostrando só os primeiros ${MAX_FILES} arquivos.`);
  const files: MediaFile[] = [];
  for (const f of unique) {
    const kind = kindOf(f)!;
    const info = kind === 'legenda' ? {} : await probe(f);
    files.push({ path: f, name: path.basename(f), kind, size: fs.statSync(f).size, ...info });
  }
  return { files, errors };
}

// ---------- Plano (feito pela IA) ----------

export interface PlanStep {
  descricao: string;
  tipo: 'ffmpeg' | 'arquivo';
  args?: string[];
  nome?: string;
  conteudo?: string;
}

export interface Plan {
  resumo: string;
  passos: PlanStep[];
  avisos: string[];
  kdenlive: string;
}

export const STUDIO_SYSTEM = `Você é editor de vídeo e imagem para Instagram e especialista em FFmpeg, escrevendo em português do Brasil.
Você transforma o pedido da pessoa num plano de comandos do FFmpeg que o dashboard vai executar depois que ela conferir.
Seja cuidadoso: comandos válidos, que funcionem no Windows, com qualidade boa para o Instagram.`;

export function planPrompt(files: MediaFile[], outDir: string, caps: Capabilities, request: string): string {
  const model = caps.models[0] ? path.join(modelsDir(), caps.models[0]) : null;
  const list = files
    .map((f) => `- ${f.path} | ${f.kind}${f.duration ? ` | ${f.duration}s` : ''}${f.width ? ` | ${f.width}x${f.height}` : ''}${f.kind === 'video' ? ` | áudio: ${f.audio ? 'sim' : 'não'}` : ''}`)
    .join('\n');
  return `# Arquivos escolhidos
${list}

# Pasta de saída
${outDir} (o FFmpeg roda DENTRO dela: na saída use só o nome do arquivo)

# Pedido
${request}

# Regras do plano
- Responda SOMENTE com um JSON válido, sem texto antes ou depois:
  {"resumo": "o que vai ser feito, em 1 ou 2 frases", "passos": [{"descricao": "o que este passo faz", "tipo": "ffmpeg", "args": ["-i", "C:\\\\...\\\\video.mp4", "...", "saida.mp4"]}], "avisos": ["..."], "kdenlive": "o que for melhor fazer no Kdenlive, ou vazio"}
- "args" são os argumentos do FFmpeg, sem a palavra ffmpeg e sem -y (o dashboard nunca sobrescreve). O ÚLTIMO argumento é o arquivo de saída: só o nome, novo e descritivo (ex.: "reels-vertical.mp4").
- Entradas (-i): os caminhos completos acima, exatamente como estão, ou o nome de um arquivo gerado num passo anterior.
- Para criar um arquivo de texto (ex.: legenda .srt), use {"descricao": "...", "tipo": "arquivo", "nome": "legendas.srt", "conteudo": "..."}.
- No máximo ${MAX_STEPS} passos. Nunca use -f concat, protocolos de rede (http, rtmp...) nem caminhos fora das pastas acima.
- Instagram: Reels e Story 1080x1920 (9:16); feed 1080x1350 (4:5) ou 1080x1080. Vídeo: -c:v libx264 -pix_fmt yuv420p -preset medium -crf 20 -r 30 -c:a aac -b:a 128k -movflags +faststart. Imagem: JPEG (-q:v 2). Reels: até 90 s é o ideal; Story: até 60 s.
- Vídeo horizontal para 9:16: prefira fundo desfocado (o próprio vídeo ampliado e borrado atrás) em vez de cortar o assunto.
- Texto na tela: drawtext com fontfile='C\\:/Windows/Fonts/arial.ttf' (com a barra antes dos dois-pontos), caixa semitransparente e margem segura (longe das bordas e da parte de baixo, onde o Instagram põe botões).
- Legendas: crie o .srt com um passo "arquivo" (tempos coerentes com a duração do vídeo) ${caps.subtitles ? "e queime com subtitles=legendas.srt:force_style='FontName=Arial,FontSize=13,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Alignment=2,MarginV=70'" : 'e escreva com drawtext (o filtro subtitles não está disponível neste FFmpeg)'}.
- ${
    caps.whisper && model
      ? `Legenda automática da fala DISPONÍVEL: um passo com ["-i", "<vídeo>", "-vn", "-af", "whisper=model=${model.replace(/\\/g, '/').replace(':', '\\:')}:language=pt:queue=3:destination=legendas.srt:format=srt", "-f", "null", "-"] gera o legendas.srt; depois queime as legendas num segundo passo.`
      : 'Legenda automática da fala NÃO está disponível aqui: se pedirem legenda do que é falado, explique em "avisos" que dá para gerar no Kdenlive (Legendagem automática) e exportar o .srt, ou peça o texto; se o pedido trouxer o texto, use-o.'
  }
- Se algo não ficar bom com FFmpeg (edição fina, efeitos, animações), diga em "kdenlive" como fazer lá, em passos curtos.`;
}

export function parsePlan(text: string): Plan {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new StudioError(502, 'A IA não devolveu o plano no formato esperado. Tente de novo ou detalhe mais o pedido.');
  }
  const passos = (Array.isArray(data.passos) ? data.passos : []).map((p: Record<string, unknown>) => ({
    descricao: String(p?.descricao ?? '').trim(),
    tipo: p?.tipo === 'arquivo' ? ('arquivo' as const) : ('ffmpeg' as const),
    args: Array.isArray(p?.args) ? p.args.map(String) : undefined,
    nome: typeof p?.nome === 'string' ? p.nome.trim() : undefined,
    conteudo: typeof p?.conteudo === 'string' ? p.conteudo : undefined,
  }));
  return {
    resumo: String(data.resumo ?? '').trim(),
    passos,
    avisos: (Array.isArray(data.avisos) ? data.avisos : []).map(String).filter(Boolean),
    kdenlive: String(data.kdenlive ?? '').trim(),
  };
}

// ---------- Validação (o que torna seguro executar) ----------

const FORBIDDEN_ARGS = new Set(['-y', '-filter_script', '-filter_complex_script', '-dump_attachment', '-attach', '-protocol_whitelist', '-safe']);
const PROTOCOL = /(^|[=';,\s])(https?|rtmps?|rtsp|tcp|udp|ftp|sftp|smb|srt|data|concat|subfile|pipe|file|async|tls|crypto|unix|gopher|icecast|mmsh?|zmq)\s*:/i;
const PLAIN_NAME = /^[\p{L}\p{N} _().-]{1,120}$/u;

const inside = (p: string, roots: string[]) => {
  const abs = path.resolve(p).toLowerCase();
  return roots.some((r) => {
    const root = path.resolve(r).toLowerCase();
    return abs === root || abs.startsWith(root + path.sep);
  });
};

/** Caminhos absolutos do Windows escondidos dentro de um argumento (ex.: subtitles='C\:/x/a.srt'). */
export function embeddedPaths(arg: string): string[] {
  const out: string[] = [];
  const re = /(?:^|[='"\s,(])([A-Za-z])\\?:([\\/][^'":,;|\]\n]*)/g;
  for (const m of arg.matchAll(re)) out.push(`${m[1]}:${m[2]}`.trim());
  return out;
}

export interface PlanContext {
  /** Arquivos escolhidos (caminhos completos). */
  inputs: string[];
  outDir: string;
}

/** Problemas do plano; lista vazia = pode executar. */
export function validatePlan(plan: Plan, ctx: PlanContext): string[] {
  const problems: string[] = [];
  const roots = [...new Set(ctx.inputs.map((f) => path.dirname(f))), ctx.outDir, fontsDir(), modelsDir()];
  const inputs = new Set(ctx.inputs.map((f) => path.resolve(f).toLowerCase()));
  const produced = new Set<string>();
  if (!plan.passos.length) problems.push('O plano não tem passos.');
  if (plan.passos.length > MAX_STEPS) problems.push(`O plano tem mais de ${MAX_STEPS} passos.`);

  plan.passos.forEach((step, i) => {
    const n = `Passo ${i + 1}`;
    if (step.tipo === 'arquivo') {
      const name = step.nome ?? '';
      if (!PLAIN_NAME.test(name) || !TEXT_EXT.has(path.extname(name).toLowerCase())) problems.push(`${n}: arquivo de texto inválido ("${name}").`);
      else if ((step.conteudo ?? '').length > 200_000) problems.push(`${n}: texto grande demais.`);
      else produced.add(name.toLowerCase());
      return;
    }
    const args = step.args ?? [];
    if (!args.length) return problems.push(`${n}: sem argumentos.`);
    if (args.length > 300) return problems.push(`${n}: argumentos demais.`);
    for (let k = 0; k < args.length; k++) {
      const a = args[k];
      if (FORBIDDEN_ARGS.has(a)) problems.push(`${n}: a opção ${a} não é permitida.`);
      if (a === '-f' && args[k + 1] === 'concat') problems.push(`${n}: use o filtro concat (o demuxer concat não é permitido).`);
      if (PROTOCOL.test(a)) problems.push(`${n}: endereços de rede ou protocolos não são permitidos ("${a.slice(0, 60)}").`);
      if (/\\\\|\/\/[^/]/.test(a) && /^[\\/]{2}/.test(a)) problems.push(`${n}: caminhos de rede não são permitidos.`);
      if (/(^|[\\/])\.\.([\\/]|$)/.test(a)) problems.push(`${n}: ".." não é permitido em caminhos.`);
      const paths = path.isAbsolute(a) && !a.startsWith('-') ? [a] : embeddedPaths(a);
      for (const p of paths) if (!inside(p, roots)) problems.push(`${n}: o caminho "${p}" está fora das pastas escolhidas.`);
      if (a === '-i') {
        const src = args[k + 1] ?? '';
        const lavfi = args[k - 2] === '-f' && args[k - 1] === 'lavfi';
        const ok = lavfi || inputs.has(path.resolve(src).toLowerCase()) || (PLAIN_NAME.test(src) && produced.has(src.toLowerCase()));
        if (!ok) problems.push(`${n}: a entrada "${src}" não é um dos arquivos escolhidos nem foi gerada antes.`);
      }
    }
    const out = args[args.length - 1];
    const nullOut = out === '-' && args.includes('null');
    if (!nullOut) {
      // A saída vai sempre para a pasta "editados": nunca coincide com um original.
      if (!PLAIN_NAME.test(out) || !OUTPUT_EXT.has(path.extname(out).toLowerCase())) {
        problems.push(`${n}: a saída deve ser só um nome de arquivo de mídia (recebi "${out}").`);
      } else produced.add(out.toLowerCase());
    }
    // Arquivos gerados por filtros (ex.: whisper ... destination=legendas.srt) também viram entradas válidas depois.
    for (const a of args) for (const m of a.matchAll(/destination=([\p{L}\p{N} _().-]+\.(?:srt|txt|json))/gu)) produced.add(m[1].toLowerCase());
  });
  return [...new Set(problems)];
}

// ---------- Execução ----------

export type StepStatus = 'fila' | 'rodando' | 'ok' | 'erro';

export interface StudioJob {
  id: string;
  outDir: string;
  steps: { descricao: string; status: StepStatus; log?: string }[];
  outputs: string[];
  done: boolean;
  error?: string;
}

const plans = new Map<string, { plan: Plan; ctx: PlanContext; problems: string[]; at: number }>();
const jobs = new Map<string, StudioJob>();
const pending = new Map<string, Promise<void>>();

export const jobFinished = (id: string) => pending.get(id) ?? Promise.resolve();
export const getStudioJob = (id: string) => jobs.get(id);

/** Guarda o plano no servidor: só um plano guardado (e validado) pode ser executado. */
export function storePlan(plan: Plan, ctx: PlanContext): { id: string; problems: string[] } {
  for (const [id, p] of plans) if (Date.now() - p.at > 6 * 3_600_000) plans.delete(id);
  const id = crypto.randomUUID();
  const problems = validatePlan(plan, ctx);
  plans.set(id, { plan, ctx, problems, at: Date.now() });
  return { id, problems };
}

/** Pastas que o botão "Abrir pasta" pode abrir: as de saída dos trabalhos. */
export const knownOutDirs = () => new Set([...jobs.values()].map((j) => path.resolve(j.outDir).toLowerCase()));

export function startPlan(planId: string): StudioJob {
  const stored = plans.get(planId);
  if (!stored) throw new StudioError(404, 'Plano não encontrado (o dashboard pode ter reiniciado). Planeje de novo.');
  if (stored.problems.length) throw new StudioError(400, 'O plano tem problemas e não pode ser executado. Peça de novo à IA.');
  const { plan, ctx } = stored;
  fs.mkdirSync(ctx.outDir, { recursive: true });
  const job: StudioJob = { id: crypto.randomUUID(), outDir: ctx.outDir, steps: plan.passos.map((p) => ({ descricao: p.descricao, status: 'fila' })), outputs: [], done: false };
  jobs.set(job.id, job);
  const run = (async () => {
    for (const [i, step] of plan.passos.entries()) {
      const s = job.steps[i];
      s.status = 'rodando';
      try {
        if (step.tipo === 'arquivo') {
          const file = path.join(ctx.outDir, step.nome!);
          if (fs.existsSync(file)) throw new Error(`Já existe "${step.nome}" na pasta ${OUTPUT_FOLDER}: apague ou peça outro nome.`);
          fs.writeFileSync(file, step.conteudo ?? '');
          job.outputs.push(step.nome!);
        } else {
          const r = await runProcess(config.ffmpegBin, ['-hide_banner', '-nostdin', '-n', ...step.args!], { cwd: ctx.outDir, timeoutMs: STEP_TIMEOUT });
          s.log = r.stderr.split('\n').slice(-25).join('\n').trim();
          if (r.code !== 0) {
            throw new Error(/already exists/i.test(r.stderr) ? `Já existe um arquivo com esse nome na pasta ${OUTPUT_FOLDER}.` : `O FFmpeg parou com erro (código ${r.code}).`);
          }
          const out = step.args![step.args!.length - 1];
          if (out !== '-') job.outputs.push(out);
        }
        s.status = 'ok';
      } catch (e) {
        s.status = 'erro';
        job.error = (e as Error).message;
        break;
      }
    }
    job.done = true;
    pending.delete(job.id);
  })();
  pending.set(job.id, run);
  return job;
}

// ---------- Modelo da legenda automática (Whisper) ----------

export const WHISPER_MODELS: Record<string, { file: string; size: string }> = {
  base: { file: 'ggml-base.bin', size: '148 MB' },
  small: { file: 'ggml-small.bin', size: '466 MB' },
};

const downloads = new Map<string, { received: number; total: number; done: boolean; error?: string }>();
export const modelDownload = (name: string) => downloads.get(name) ?? null;

/** Baixa um modelo do whisper.cpp (repositório oficial no Hugging Face) para data/modelos. */
export function downloadModel(name: string, fetcher: typeof fetch = fetch): void {
  const m = WHISPER_MODELS[name];
  if (!m) throw new StudioError(400, 'Modelo desconhecido.');
  if (downloads.get(name) && !downloads.get(name)!.done) return;
  const state = { received: 0, total: 0, done: false as boolean, error: undefined as string | undefined };
  downloads.set(name, state);
  fs.mkdirSync(modelsDir(), { recursive: true });
  const target = path.join(modelsDir(), m.file);
  const partial = `${target}.parcial`;
  (async () => {
    try {
      const res = await fetcher(`https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${m.file}`);
      if (!res.ok || !res.body) throw new Error(`download falhou (${res.status})`);
      state.total = Number(res.headers.get('content-length') ?? 0);
      const out = fs.createWriteStream(partial);
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        state.received += chunk.length;
        if (!out.write(chunk)) await new Promise<void>((ok) => out.once('drain', () => ok()));
      }
      await new Promise<void>((ok, fail) => out.end((e?: Error | null) => (e ? fail(e) : ok())));
      fs.renameSync(partial, target);
      capsCache = null;
    } catch (e) {
      state.error = (e as Error).message;
      fs.rmSync(partial, { force: true });
    } finally {
      state.done = true;
    }
  })();
}
