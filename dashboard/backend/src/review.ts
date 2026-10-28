// O que o Jev faz no dashboard: revisar legendas antes de publicar e classificar gancho/estilo dos posts
// para os Experimentos. Padrões da TypeSafe (docs.typesafe.ai/patterns): estado mínimo, várias perguntas
// atômicas numa chamada só, nota composta com pesos no código e confiança como autorização para agir:
// abaixo do limite, o dashboard mostra a resposta mas não grava nada sozinho.
import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { accountFolder, type AccountConfig } from './config.ts';
import { JevError, type Answer, type JevClient, type Question, type SystemOneResponse } from './jev.ts';
import { DEFAULT_HOOKS, DEFAULT_STYLES, FORMAT_LABELS, formatOf } from './metrics.ts';

export const CAPTION_MAX = 2200;
export const HASHTAG_SOFT = 5;
export const HASHTAG_MAX = 30;
/** O Instagram corta a legenda no feed perto disso; a 1ª linha precisa caber. */
export const FIRST_LINE_MAX = 125;
/** Abaixo disso o Jev está "em dúvida" e a tela avisa. */
export const MIN_CONFIDENCE = 0.5;
/** A classificação automática só grava gancho/estilo com confiança a partir disso. */
export const AUTOTAG_MIN_CONFIDENCE = 0.6;
export const AUTOTAG_BATCH = 40;
const AUTOTAG_CONCURRENCY = 4;

/** Peso de cada dimensão na nota da legenda (0 a 100). */
export const REVIEW_WEIGHTS = { gancho: 35, clareza: 25, cta: 20, tom: 20 } as const;
type DimensionKey = keyof typeof REVIEW_WEIGHTS;

const KIND_LABELS: Record<string, string> = { image: 'Post estático', carousel: 'Carrossel', reel: 'Reels', story: 'Story' };

const HOOK_HINTS: Record<string, string> = {
  Pergunta: 'Abre com uma pergunta direta ao leitor',
  'Número/lista': 'Promete uma lista ou quantidade ("5 erros", "3 dicas")',
  'Erro comum': 'Aponta um erro que o público costuma cometer',
  'Antes e depois': 'Mostra uma transformação ou comparação de antes e depois',
  Bastidor: 'Convida a ver o processo, a rotina ou como algo é feito',
  'Polêmica/contraste': 'Contraria uma crença comum ou cria um contraste forte',
  Promessa: 'Promete um benefício ou resultado concreto ao leitor',
  'História pessoal': 'Começa contando uma história ou experiência pessoal',
};
const STYLE_HINTS: Record<string, string> = {
  Educativo: 'Ensina algo ou explica um conceito',
  Inspiracional: 'Emociona, motiva ou convida à reflexão',
  Bastidores: 'Mostra o processo, a rotina ou como o trabalho é feito',
  'Prova social': 'Depoimentos, resultados de clientes ou números de quem já comprou',
  'Oferta/venda': 'Apresenta produto ou serviço, preço, condição ou chamada para comprar',
  Humor: 'Busca fazer rir',
  Tutorial: 'Passo a passo prático',
};
const OTHER = 'Outro';
const withOther = (names: string[], hints: Record<string, string>) => ({
  ...Object.fromEntries(names.map((n) => [n, hints[n] ?? null])),
  [OTHER]: 'Nenhuma das opções anteriores, ou não dá para identificar',
});

const HOOK_QUESTION: Question = {
  type: 'choice',
  instructions: { pergunta: 'Que tipo de gancho a legenda usa para prender a atenção?', foco: 'primeira linha da legenda' },
  criteria: withOther(DEFAULT_HOOKS, HOOK_HINTS),
};
const STYLE_QUESTION: Question = {
  type: 'choice',
  instructions: 'Qual é o estilo predominante deste conteúdo?',
  criteria: withOther(DEFAULT_STYLES, STYLE_HINTS),
};

const REVIEW_QUESTIONS: Record<string, Question> = {
  gancho: {
    type: 'score',
    instructions: {
      pergunta: 'Quão forte é a primeira linha como gancho para a pessoa parar de rolar o feed e abrir a legenda?',
      foco: 'primeira_linha',
    },
    criteria: [
      'Genérica ou vazia: não dá motivo para continuar lendo',
      'Desperta algum interesse, mas é previsível',
      'Gancho claro: promete um benefício, levanta uma dúvida ou cria contraste',
      'Gancho irresistível: específico, surpreendente e ligado ao público',
    ],
  },
  clareza: {
    type: 'score',
    instructions: 'Quão clara e fácil de ler no celular é a legenda?',
    criteria: [
      'Confusa: não dá para entender a mensagem principal',
      'Entende-se, mas com rodeios ou ideias misturadas',
      'Clara: uma mensagem principal fácil de entender',
      'Muito clara e escaneável: frases curtas, uma ideia por parágrafo',
    ],
  },
  cta: {
    type: 'noul',
    instructions:
      'A legenda pede uma ação concreta ao leitor, como salvar, comentar, compartilhar, enviar para alguém, clicar no link da bio, chamar no direct, comprar ou agendar?',
  },
  risco: {
    type: 'noul',
    instructions:
      'A legenda promete resultado garantido, faz alegação exagerada sobre saúde ou dinheiro, ou tem conteúdo que pode ferir as diretrizes do Instagram?',
  },
  objetivo: {
    type: 'choice',
    instructions: 'Qual é o objetivo principal desta legenda?',
    criteria: {
      alcance: 'Ser compartilhada e descoberta por pessoas novas',
      salvamento: 'Ser guardada como referência para consultar depois',
      conversa: 'Gerar comentários e conversa',
      venda: 'Levar a comprar, contratar ou agendar',
      autoridade: 'Mostrar conhecimento ou bastidores para gerar confiança',
      outro: 'Nenhum dos anteriores',
    },
  },
  gancho_tipo: HOOK_QUESTION,
  estilo: STYLE_QUESTION,
};

const TONE_QUESTION: Question = {
  type: 'score',
  instructions: {
    pergunta: 'A legenda soa como a marca descrita no perfil da conta (tom de voz, público e temas)?',
    comparar: ['legenda', 'perfil_da_conta'],
  },
  criteria: ['Destoa do perfil da conta', 'Parcialmente alinhada', 'Alinhada ao tom e ao público da conta'],
};

export const OBJECTIVE_LABELS: Record<string, string> = {
  alcance: 'Alcance',
  salvamento: 'Salvamento',
  conversa: 'Conversa',
  venda: 'Venda',
  autoridade: 'Autoridade',
  outro: 'Outro',
};

export interface Dimension {
  key: DimensionKey;
  label: string;
  /** 0 a 1. */
  value: number;
  weight: number;
  /** Nível do critério mais próximo (score) ou "sim/não" (noul). */
  level: string;
  confidence: number | null;
  uncertain: boolean;
}

export interface Classification {
  value: string;
  label: string;
  confidence: number;
  uncertain: boolean;
}

export interface CaptionReview {
  grade: number;
  dimensions: Dimension[];
  objective: Classification;
  /** null quando o Jev não reconheceu nenhuma das opções. */
  hook: Classification | null;
  style: Classification | null;
  /** Probabilidade (0 a 1) de promessa exagerada ou tema sensível. */
  risk: number;
  tips: string[];
  warnings: string[];
  toneEvaluated: boolean;
}

export const countHashtags = (text: string) => (text.match(/#[\p{L}\p{N}_]+/gu) ?? []).length;

function accountProfile(account: AccountConfig): string | null {
  try {
    const text = fs.readFileSync(path.join(accountFolder(account), 'claude.md'), 'utf8').trim();
    return text ? text.slice(0, 4000) : null;
  } catch {
    return null;
  }
}

export function logCall(db: DatabaseSync, accountId: string, kind: string, r: SystemOneResponse): void {
  db.prepare('INSERT INTO jev_calls(account_id, kind, input_tokens, output_tokens, created_at) VALUES(?, ?, ?, ?, ?)').run(
    accountId,
    kind,
    r.usage?.input_tokens ?? null,
    r.usage?.output_tokens ?? null,
    Date.now(),
  );
}

function answer<T extends Answer['type']>(r: SystemOneResponse, key: string, type: T): Extract<Answer, { type: T }> {
  const a = r.answers?.[key];
  if (!a || a.type !== type) throw new JevError(502, `Jev: resposta sem "${key}".`);
  return a as Extract<Answer, { type: T }>;
}

function scoreDimension(r: SystemOneResponse, key: DimensionKey, label: string, q: Question): Dimension {
  const a = answer(r, key, 'score');
  const levels = (q as Extract<Question, { type: 'score' }>).criteria;
  const top = levels.length - 1;
  const value = Math.min(1, Math.max(0, a.score / top));
  return {
    key,
    label,
    value,
    weight: REVIEW_WEIGHTS[key],
    level: String(levels[Math.round(Math.min(top, Math.max(0, a.score)))]),
    confidence: a.confidence,
    uncertain: a.confidence < MIN_CONFIDENCE,
  };
}

function classification(r: SystemOneResponse, key: string, labels?: Record<string, string>): Classification | null {
  const a = answer(r, key, 'choice');
  if (a.choice === OTHER || a.choice === 'outro') return null;
  return { value: a.choice, label: labels?.[a.choice] ?? a.choice, confidence: a.confidence, uncertain: a.confidence < MIN_CONFIDENCE };
}

/** Regras fixas, sem IA: o que dá para checar contando. */
export function captionChecks(caption: string): { tips: string[]; warnings: string[] } {
  const tips: string[] = [];
  const warnings: string[] = [];
  const tags = countHashtags(caption);
  const firstLine = caption.trim().split('\n')[0] ?? '';
  if (caption.length > CAPTION_MAX) warnings.push(`A legenda passa de ${CAPTION_MAX} caracteres, o limite do Instagram.`);
  if (tags > HASHTAG_MAX) warnings.push(`${tags} hashtags: o Instagram recusa mais de ${HASHTAG_MAX}.`);
  else if (tags > HASHTAG_SOFT) tips.push(`${tags} hashtags: prefira até ${HASHTAG_SOFT}, específicas do nicho.`);
  if (firstLine.length > FIRST_LINE_MAX)
    tips.push(`A 1ª linha tem ${firstLine.length} caracteres; o feed corta perto de ${FIRST_LINE_MAX}. Encurte o gancho.`);
  return { tips, warnings };
}

export async function reviewCaption(
  db: DatabaseSync,
  client: JevClient,
  account: AccountConfig,
  input: { caption: string; kind?: string },
): Promise<CaptionReview> {
  const caption = input.caption.trim();
  if (!caption) throw new JevError(400, 'Escreva a legenda antes de pedir a revisão.');
  const profile = accountProfile(account);
  const state: Record<string, string> = {
    formato: KIND_LABELS[input.kind ?? ''] ?? 'Post',
    primeira_linha: caption.split('\n')[0],
    legenda: caption.slice(0, CAPTION_MAX),
  };
  const questions = { ...REVIEW_QUESTIONS };
  if (profile) {
    state.perfil_da_conta = profile;
    questions.tom = TONE_QUESTION;
  }

  const r = await client.systemOne(state, questions);
  logCall(db, account.id, 'review', r);

  const cta = answer(r, 'cta', 'noul').noul;
  const dimensions: Dimension[] = [
    scoreDimension(r, 'gancho', 'Gancho', REVIEW_QUESTIONS.gancho),
    scoreDimension(r, 'clareza', 'Clareza', REVIEW_QUESTIONS.clareza),
    { key: 'cta', label: 'Chamada para ação', value: cta, weight: REVIEW_WEIGHTS.cta, level: cta >= 0.5 ? 'Tem' : 'Não tem', confidence: null, uncertain: cta > 0.35 && cta < 0.65 },
  ];
  if (profile) dimensions.push(scoreDimension(r, 'tom', 'Tom da marca', TONE_QUESTION));

  const totalWeight = dimensions.reduce((s, d) => s + d.weight, 0);
  const grade = Math.round((dimensions.reduce((s, d) => s + d.weight * d.value, 0) / totalWeight) * 100);
  const objective = classification(r, 'objetivo', OBJECTIVE_LABELS) ?? { value: 'outro', label: 'Outro', confidence: 0, uncertain: true };
  const risk = answer(r, 'risco', 'noul').noul;

  const { tips, warnings } = captionChecks(caption);
  const low = (key: DimensionKey) => {
    const d = dimensions.find((x) => x.key === key);
    return d != null && d.value < 0.5;
  };
  if (low('gancho')) tips.push('Fortaleça a 1ª linha, que aparece antes do "mais": use uma pergunta, um número, um erro comum ou uma promessa clara.');
  if (low('clareza')) tips.push('Deixe uma mensagem principal só, com frases curtas e um parágrafo por ideia.');
  if (low('cta')) tips.push('Termine pedindo uma ação: salvar, comentar, enviar para alguém, clicar no link da bio ou chamar no direct.');
  if (low('tom')) tips.push('O texto destoa do tom de voz descrito no claude.md da conta. Ajuste o vocabulário ao público.');
  if (objective.value === 'venda' && cta < 0.5) warnings.push('Post de venda sem chamada para ação clara: diga como comprar ou contratar.');
  if (risk >= 0.5) warnings.push('Pode haver promessa exagerada ou tema sensível (saúde, dinheiro, resultado garantido). Revise antes de publicar.');
  const unsure = dimensions.filter((d) => d.uncertain).map((d) => d.label.toLowerCase());
  if (unsure.length) tips.push(`O Jev ficou em dúvida sobre ${unsure.join(' e ')}: confira com atenção.`);

  return {
    grade,
    dimensions,
    objective,
    hook: classification(r, 'gancho_tipo'),
    style: classification(r, 'estilo'),
    risk,
    tips,
    warnings,
    toneEvaluated: Boolean(profile),
  };
}

// ---------- Classificação automática dos posts (Experimentos) ----------

const PENDING_SQL = `
  FROM media m LEFT JOIN media_tags t ON t.media_id = m.id
  WHERE m.account_id = ? AND TRIM(COALESCE(m.caption, '')) <> ''
    AND (t.media_id IS NULL OR (t.hook IS NULL AND t.style IS NULL AND t.tag_confidence IS NULL))`;

export const pendingAutotag = (db: DatabaseSync, accountId: string) =>
  (db.prepare(`SELECT COUNT(*) AS n ${PENDING_SQL}`).get(accountId) as { n: number }).n;

export interface AutotagResult {
  /** Posts que ganharam gancho e/ou estilo. */
  tagged: number;
  /** Posts em que o Jev ficou em dúvida: ficam para a usuária registrar. */
  uncertain: number;
  failed: number;
  remaining: number;
}

/**
 * Sugere gancho e estilo para posts ainda sem registro (os mais recentes primeiro). Grava só o que vier
 * com confiança alta, marcado como 'jev'; quando a usuária salva o registro, ele vira manual.
 * Posts em dúvida também ficam marcados (tag_confidence) para não serem consultados de novo.
 */
export async function autotagPosts(db: DatabaseSync, client: JevClient, accountId: string, limit = AUTOTAG_BATCH): Promise<AutotagResult> {
  const posts = db
    .prepare(`SELECT m.id, m.caption, m.media_type, m.product_type ${PENDING_SQL} ORDER BY m.timestamp DESC LIMIT ?`)
    .all(accountId, limit) as { id: string; caption: string; media_type: string; product_type: string | null }[];
  const save = db.prepare(
    `INSERT INTO media_tags(media_id, account_id, hook, style, tagged_by, tag_confidence) VALUES(?, ?, ?, ?, 'jev', ?)
     ON CONFLICT(media_id) DO UPDATE SET hook = excluded.hook, style = excluded.style, tagged_by = 'jev',
       tag_confidence = excluded.tag_confidence`,
  );
  const result: AutotagResult = { tagged: 0, uncertain: 0, failed: 0, remaining: 0 };
  let lastError: Error | null = null;
  let next = 0;

  const worker = async () => {
    while (next < posts.length) {
      const p = posts[next++];
      try {
        const r = await client.systemOne(
          { formato: FORMAT_LABELS[formatOf(p.media_type, p.product_type)], legenda: p.caption.slice(0, CAPTION_MAX) },
          { gancho_tipo: HOOK_QUESTION, estilo: STYLE_QUESTION },
        );
        logCall(db, accountId, 'autotag', r);
        const pick = (key: string) => {
          const a = answer(r, key, 'choice');
          return { value: a.choice !== OTHER && a.confidence >= AUTOTAG_MIN_CONFIDENCE ? a.choice : null, confidence: a.confidence };
        };
        const hook = pick('gancho_tipo');
        const style = pick('estilo');
        save.run(p.id, accountId, hook.value, style.value, Math.min(hook.confidence, style.confidence));
        if (hook.value || style.value) result.tagged++;
        else result.uncertain++;
      } catch (e) {
        // Chave inválida ou limite: não adianta seguir.
        if (e instanceof JevError && (e.status === 503 || e.status === 429)) {
          next = posts.length;
          lastError = e;
        } else {
          result.failed++;
          lastError = e as Error;
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(AUTOTAG_CONCURRENCY, posts.length) }, worker));

  if (lastError && result.tagged + result.uncertain === 0) throw lastError;
  result.remaining = pendingAutotag(db, accountId);
  return result;
}

/** Uso do Jev nos últimos 30 dias (tokens de entrada são os cobrados). */
export function jevUsage(db: DatabaseSync, now = Date.now()) {
  return db
    .prepare(
      `SELECT kind, COUNT(*) AS calls, COALESCE(SUM(input_tokens), 0) AS inputTokens
       FROM jev_calls WHERE created_at >= ? GROUP BY kind`,
    )
    .all(now - 30 * 86_400_000) as { kind: string; calls: number; inputTokens: number }[];
}
