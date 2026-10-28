// Regras de negócio puras (sem banco): score ponderado, formatos e alertas.

export const SIGNALS = ['shares', 'saved', 'comments', 'likes', 'profile_visits'] as const;
export type Signal = (typeof SIGNALS)[number];
export type Weights = Record<Signal, number>;

export const SIGNAL_LABELS: Record<Signal, string> = {
  shares: 'Compartilhamentos',
  saved: 'Salvamentos',
  comments: 'Comentários',
  likes: 'Curtidas',
  profile_visits: 'Visitas ao perfil',
};

/** Peso padrão, do maior para o menor: compartilhar > salvar > comentar > curtir > visitar perfil. */
export const DEFAULT_WEIGHTS: Weights = { shares: 5, saved: 4, comments: 3, likes: 1, profile_visits: 0.5 };

export type PostSignals = Partial<Record<Signal | 'reach', number | null>>;

export interface Score {
  /** Pontos por 100 contas alcançadas; null sem alcance. */
  score: number | null;
  /** Contribuição de cada sinal para o score. */
  parts: Record<Signal, number>;
}

/**
 * Score de engajamento ponderado, normalizado pelo alcance para comparar posts
 * grandes e pequenos: soma(peso × sinal) / alcance × 100.
 */
export function scorePost(post: PostSignals, weights: Weights = DEFAULT_WEIGHTS): Score {
  const reach = post.reach ?? 0;
  const parts = Object.fromEntries(SIGNALS.map((s) => [s, 0])) as Record<Signal, number>;
  if (reach <= 0) return { score: null, parts };
  let score = 0;
  for (const s of SIGNALS) {
    const value = ((post[s] ?? 0) * (weights[s] ?? 0) * 100) / reach;
    parts[s] = round(value);
    score += value;
  }
  return { score: round(score), parts };
}

export function engagementRate(interactions: number | null | undefined, reach: number | null | undefined): number | null {
  if (!reach || interactions == null) return null;
  return round((interactions / reach) * 100);
}

/** Opções iniciais do registro de experimento (cada conta pode criar outras). */
export const DEFAULT_HOOKS = ['Pergunta', 'Número/lista', 'Erro comum', 'Antes e depois', 'Bastidor', 'Polêmica/contraste', 'Promessa', 'História pessoal'];
export const DEFAULT_STYLES = ['Educativo', 'Inspiracional', 'Bastidores', 'Prova social', 'Oferta/venda', 'Humor', 'Tutorial'];

export type Format = 'reels' | 'carrossel' | 'post' | 'video';

export const FORMAT_LABELS: Record<Format, string> = {
  reels: 'Reels',
  carrossel: 'Carrossel',
  post: 'Post estático',
  video: 'Vídeo',
};

export function formatOf(mediaType: string, productType: string | null | undefined): Format {
  if (productType === 'REELS') return 'reels';
  if (mediaType === 'CAROUSEL_ALBUM') return 'carrossel';
  if (mediaType === 'VIDEO') return 'video';
  return 'post';
}

export interface AlertThresholds {
  noPostDays: number;
  tokenDays: number;
  reachDropPct: number;
}

export const DEFAULT_THRESHOLDS: AlertThresholds = { noPostDays: 4, tokenDays: 10, reachDropPct: 30 };

export interface AlertInput {
  connected: boolean;
  tokenDaysLeft: number | null;
  daysSinceLastPost: number | null;
  reachLast7: number | null;
  reachPrev7: number | null;
  syncError: string | null;
  failuresLast24h: number;
}

export interface Alert {
  level: 'error' | 'warn' | 'info';
  code: string;
  text: string;
}

export function computeAlerts(input: AlertInput, t: AlertThresholds = DEFAULT_THRESHOLDS): Alert[] {
  const alerts: Alert[] = [];
  if (!input.connected) {
    alerts.push({ level: 'error', code: 'disconnected', text: 'Conta desconectada: clique em "Conectar Instagram".' });
    return alerts;
  }
  if (input.tokenDaysLeft !== null && input.tokenDaysLeft <= t.tokenDays) {
    alerts.push({
      level: 'warn',
      code: 'token',
      text: `O acesso expira em ${input.tokenDaysLeft} dia(s). Mantenha o dashboard aberto para renovar ou reconecte.`,
    });
  }
  if (input.daysSinceLastPost === null) {
    alerts.push({ level: 'info', code: 'no-posts', text: 'Nenhum post sincronizado ainda.' });
  } else if (input.daysSinceLastPost >= t.noPostDays) {
    alerts.push({ level: 'warn', code: 'no-post', text: `Sem postar há ${input.daysSinceLastPost} dias.` });
  }
  if (input.reachLast7 !== null && input.reachPrev7 && input.reachPrev7 > 0) {
    const drop = ((input.reachPrev7 - input.reachLast7) / input.reachPrev7) * 100;
    if (drop >= t.reachDropPct) {
      alerts.push({
        level: 'warn',
        code: 'reach-drop',
        text: `Alcance dos últimos 7 dias caiu ${Math.round(drop)}% em relação aos 7 dias anteriores.`,
      });
    }
  }
  if (input.failuresLast24h > 0) {
    alerts.push({ level: 'error', code: 'publish-failed', text: `${input.failuresLast24h} publicação(ões) falharam nas últimas 24h.` });
  }
  if (input.syncError) {
    alerts.push({ level: 'error', code: 'sync', text: `Falha na sincronização: ${input.syncError}` });
  }
  return alerts;
}

/** Fase do ciclo de 10 dias: 1-3 pesquisa, 4-7 testes, 8-10 análise. */
export function cyclePhase(startDate: string, today: Date): { day: number; phase: 'pesquisa' | 'testes' | 'analise' | 'encerrado' | 'futuro' } {
  const start = new Date(`${startDate}T00:00:00`);
  const t = new Date(today);
  t.setHours(0, 0, 0, 0);
  const day = Math.floor((t.getTime() - start.getTime()) / 86_400_000) + 1;
  if (day < 1) return { day, phase: 'futuro' };
  if (day <= 3) return { day, phase: 'pesquisa' };
  if (day <= 7) return { day, phase: 'testes' };
  if (day <= 10) return { day, phase: 'analise' };
  return { day, phase: 'encerrado' };
}

export function toCsv(rows: Record<string, unknown>[], columns: { key: string; label: string }[]): string {
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return String(v).replace('.', ','); // decimal pt-BR
    const s = String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // Ponto e vírgula + BOM: o Excel em pt-BR abre direto com acentos e colunas certas.
  const lines = [columns.map((c) => esc(c.label)).join(';')];
  for (const r of rows) lines.push(columns.map((c) => esc(r[c.key])).join(';'));
  return '﻿' + lines.join('\r\n');
}

const round = (n: number) => Math.round(n * 100) / 100;
