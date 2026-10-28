// Assistente de conteúdo usando a ASSINATURA do Claude do usuário, via Claude Code CLI (`claude -p`).
// Sem chave de API: o CLI já está logado neste PC. Rodamos sem ferramentas (só texto entra e sai),
// numa pasta isolada (para não carregar CLAUDE.md de projetos) e sem salvar sessão.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { accountFolder, config, type AccountConfig } from './config.ts';
import { listPosts } from './report.ts';

export const ARTIFACTS = {
  legenda: 'Escreva uma legenda completa: gancho forte na 1ª linha (aparece antes do "mais"), corpo de valor, chamada para ação clara no final e até 5 hashtags relevantes.',
  roteiro: 'Escreva um roteiro de Reels de 15 a 45 segundos: GANCHO (0-3s, falado e em texto na tela), DESENVOLVIMENTO em cenas curtas com o que aparece na tela, e CTA final. Indique texto na tela e sugestão de B-roll por cena.',
  carrossel: 'Escreva o texto de um carrossel slide a slide (Slide 1 = capa com gancho; 5 a 10 slides; último = CTA). Frases curtas, uma ideia por slide.',
  card: 'Escreva o texto curto de um card estático (no máximo 25 palavras), impactante e legível no celular.',
  ganchos: 'Proponha 10 ganchos diferentes (primeira frase/3 primeiros segundos) para este conteúdo, variando estilo: pergunta, número, contraste, erro comum, bastidor, promessa.',
  hashtags: 'Sugira de 3 a 5 hashtags específicas do nicho e 5 palavras-chave para usar na legenda (o Instagram usa palavras-chave na busca). Explique em uma linha cada escolha.',
  som: 'Sugira o estilo de áudio para este Reels (ritmo, clima, voz/narração ou música) e como sincronizar cortes. Lembre que a música precisa estar no próprio vídeo (a API não adiciona música da biblioteca); se fizer sentido, sugira publicar pelo app para usar um áudio em alta.',
  ideias: 'Gere 10 ideias de conteúdo para esta conta, cada uma com formato sugerido (Reels, carrossel ou post), gancho e objetivo (alcance, salvamento, compartilhamento ou venda).',
  melhorar: 'Melhore o texto atual mantendo a voz da marca: gancho mais forte, mais clareza, CTA melhor. Devolva só a versão final.',
  analise: 'Analise os dados de desempenho do "texto atual" e entregue: 3 conclusões objetivas, 3 ações concretas para os próximos 10 dias e 1 experimento (formato + gancho) para testar, com a métrica que vai dizer se funcionou.',
  trafego: 'Sugira como impulsionar este conteúdo: objetivo da campanha, público (idade, local, interesses), orçamento diário inicial e duração para um teste, e como medir se deu certo.',
  livre: 'Responda ao pedido da usuária.',
} as const;
export type Artifact = keyof typeof ARTIFACTS;

export interface AskInput {
  account: AccountConfig;
  artifact: Artifact;
  instruction: string;
  currentText?: string;
  history?: { role: 'user' | 'assistant'; content: string }[];
}

const MAX_CONCURRENT = 2;
let active = 0;

export class ClaudeError extends Error {}

function accountProfile(account: AccountConfig): string {
  try {
    return fs.readFileSync(path.join(accountFolder(account), 'claude.md'), 'utf8').slice(0, 8000);
  } catch {
    return '(sem claude.md para esta conta)';
  }
}

/** Resumo do que funciona na conta, a partir das métricas sincronizadas. */
function performanceContext(db: DatabaseSync, accountId: string): string {
  const posts = listPosts(db, accountId).slice(0, 60);
  const scored = posts.filter((p) => p.score != null).sort((a, b) => b.score! - a.score!);
  if (!scored.length) return 'Ainda não há métricas sincronizadas desta conta.';
  const top = scored
    .slice(0, 5)
    .map((p) => `- [${p.formatLabel}, score ${p.score}, alcance ${p.reach ?? '?'}] ${p.caption.replace(/\s+/g, ' ').slice(0, 160)}`)
    .join('\n');
  const formats = new Map<string, number[]>();
  for (const p of scored) formats.set(p.formatLabel, [...(formats.get(p.formatLabel) ?? []), p.score!]);
  const formatLine = [...formats.entries()]
    .map(([f, s]) => `${f}: score médio ${(s.reduce((a, b) => a + b, 0) / s.length).toFixed(1)} (${s.length} posts)`)
    .join('; ');
  return `Posts com melhor desempenho (score = sinais ponderados por 100 contas alcançadas):\n${top}\nPor formato: ${formatLine}`;
}

export function buildSystemPrompt(db: DatabaseSync, input: AskInput): string {
  const { account } = input;
  return `Você é estrategista de conteúdo e copywriter de Instagram, escrevendo em português do Brasil.
Você ajuda a dona da conta @${account.username} a criar artefatos (legendas, roteiros, carrosséis, cards, ganchos, sons, estratégia de impulsionamento).

# Perfil da conta (arquivo claude.md da conta)
${accountProfile(account)}

# O que o algoritmo do Instagram valoriza (referência)
- Tempo assistido/retenção (Reels): gancho nos 3 primeiros segundos, ritmo, sem enrolação.
- Envios por DM e compartilhamentos: conteúdo que a pessoa quer mandar para alguém.
- Salvamentos: conteúdo útil, de referência (listas, passo a passo, checklists).
- Comentários com conversa real; curtidas pesam menos.
- Originalidade: conteúdo próprio, sem marca d'água de outras redes.
- Palavras-chave na legenda ajudam a busca; poucas hashtags específicas (até 5).

# Dados de desempenho da conta
${performanceContext(db, account.id)}

# Regras de resposta
- Entregue o conteúdo pronto para usar, sem introdução nem comentários sobre o que você fez.
- Mantenha a voz e o público da conta. Não invente fatos, preços ou promessas que não estejam no perfil;
  quando faltar informação, use [colchetes] para a dona preencher.
- Texto simples, sem markdown de títulos (#). Listas com hífen são permitidas.`;
}

export function buildUserPrompt(input: AskInput): string {
  const parts: string[] = [];
  if (input.history?.length) {
    parts.push(
      '# Conversa anterior sobre este artefato',
      ...input.history.map((m) => `${m.role === 'user' ? 'Usuária' : 'Você'}: ${m.content}`),
      '',
    );
  }
  parts.push(`# Tarefa\n${ARTIFACTS[input.artifact]}`);
  if (input.currentText?.trim()) parts.push(`# Texto atual do artefato\n${input.currentText.trim()}`);
  if (input.instruction.trim()) parts.push(`# Pedido da usuária\n${input.instruction.trim()}`);
  return parts.join('\n\n');
}

export async function askClaude(db: DatabaseSync, input: AskInput, timeoutMs = 3 * 60 * 1000): Promise<string> {
  if (active >= MAX_CONCURRENT) throw new ClaudeError('O Claude já está trabalhando em outros pedidos. Aguarde alguns segundos.');
  active++;
  const workDir = path.join(os.tmpdir(), 'ig-dashboard-claude');
  fs.mkdirSync(workDir, { recursive: true });
  const promptFile = path.join(workDir, `system-${crypto.randomUUID()}.txt`);
  fs.writeFileSync(promptFile, buildSystemPrompt(db, input));
  try {
    const args = [
      '-p',
      '--output-format', 'json',
      '--tools', '""', // nenhuma ferramenta: o Claude só lê e escreve texto
      '--no-session-persistence',
      '--strict-mcp-config',
      '--system-prompt-file', `"${promptFile}"`,
    ];
    if (config.claudeModel) args.push('--model', config.claudeModel);
    const out = await run(config.claudeBin, args, buildUserPrompt(input), workDir, timeoutMs);
    let parsed: { result?: string; is_error?: boolean };
    try {
      parsed = JSON.parse(out);
    } catch {
      throw new ClaudeError(`Resposta inesperada do Claude Code: ${out.slice(0, 300)}`);
    }
    if (parsed.is_error || !parsed.result) {
      throw new ClaudeError(`Claude Code retornou erro: ${parsed.result ?? 'sem resposta'}`);
    }
    return parsed.result.trim();
  } finally {
    active--;
    fs.rm(promptFile, { force: true }, () => {});
  }
}

function run(bin: string, args: string[], stdin: string, cwd: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    // shell: o `claude` no Windows é um .cmd, que o Node só executa via shell. A linha de comando é montada só com
    // argumentos fixos (nenhum texto do usuário); o pedido vai pelo stdin.
    const child = spawn([bin, ...args].join(' '), { cwd, shell: true, windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new ClaudeError('O Claude demorou demais para responder. Tente um pedido mais curto.'));
    }, timeoutMs);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new ClaudeError(`Não consegui iniciar o Claude Code (${e.message}). Ele está instalado e logado?`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve(stdout);
      const detail = (stderr || stdout).trim().slice(0, 400);
      reject(
        new ClaudeError(
          /not found|não é reconhecido|ENOENT/i.test(detail)
            ? 'Claude Code não encontrado. Instale e faça login (comando "claude") neste PC.'
            : /login|auth|credential/i.test(detail)
              ? 'Claude Code não está logado. Rode "claude" num terminal e faça login com sua assinatura.'
              : `Claude Code falhou: ${detail || `código ${code}`}`,
        ),
      );
    });
    child.stdin.end(stdin);
  });
}
