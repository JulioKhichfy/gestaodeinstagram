// Cliente do Jev (TypeSafe AI), modelo "System One": recebe um estado (texto/JSON) e perguntas tipadas
// (choice, score, noul) e devolve respostas com probabilidades. Não gera texto: quem escreve é o Claude.
// Doc conferida em out/2026: https://docs.typesafe.ai/api (POST /v1/systemone, Bearer TYPESAFE_API_KEY).
// A chave fica só no backend/.env; nunca vai para o navegador nem para logs.
import { config } from './config.ts';

export type Instructions = string | Record<string, unknown> | unknown[] | null;

export type Question =
  | { type: 'noul'; instructions?: Instructions; criteria?: { true?: Instructions; false?: Instructions } }
  /** criteria: nome da opção -> descrição (1 a 255 opções). */
  | { type: 'choice'; instructions?: Instructions; criteria: Record<string, Instructions> }
  /** criteria: níveis em ordem; a posição é o score (0, 1, 2…; 1 a 10 níveis). */
  | { type: 'score'; instructions?: Instructions; criteria: Instructions[] };

export type Answer =
  | { type: 'noul'; noul: number }
  | { type: 'choice'; choice: string; confidence: number; probabilities: Record<string, number> }
  | { type: 'score'; score: number; confidence: number; legend: Record<string, unknown>; probabilities: Record<string, number> };

export interface SystemOneResponse {
  model: string;
  answers: Record<string, Answer>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export interface JevClient {
  systemOne(state: unknown, questions: Record<string, Question>): Promise<SystemOneResponse>;
}

export class JevError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const jevConfigured = () => Boolean(config.typesafeApiKey);

const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

function detailOf(body: unknown): string {
  const d = (body as { detail?: unknown })?.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) return d.map((x) => `${(x.loc ?? []).join('.')}: ${x.msg}`).join('; ');
  return d ? JSON.stringify(d) : '';
}

export const jevClient: JevClient = {
  async systemOne(state, questions) {
    if (!jevConfigured()) throw new JevError(503, 'Jev desligado: coloque TYPESAFE_API_KEY no backend/.env e reinicie.');
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await fetch(`${config.jevBaseUrl}/v1/systemone`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${config.typesafeApiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: config.jevModel, state, questions }),
          signal: AbortSignal.timeout(30_000),
        });
      } catch (e) {
        if (attempt < 2) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        throw new JevError(502, `Jev fora do ar ou sem internet (${(e as Error).message}).`);
      }
      const body = await res.json().catch(() => ({}));
      if (res.ok) return body as SystemOneResponse;
      if ((res.status === 429 || res.status >= 500) && attempt < 2) {
        await sleep(1000 * 2 ** attempt); // 1s, 2s
        continue;
      }
      if (res.status === 401 || res.status === 403) throw new JevError(503, 'Jev recusou a chave: confira TYPESAFE_API_KEY no backend/.env.');
      if (res.status === 429) throw new JevError(429, 'Limite de uso do Jev atingido. Tente de novo em alguns minutos.');
      throw new JevError(502, `Jev: ${detailOf(body) || res.statusText}`);
    }
  },
};
