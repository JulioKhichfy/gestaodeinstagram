import { DiscoveredProfile, DiscoveryStatus } from './api';

/** Mesma regra do backend: "Decoração Afetiva!" -> "decoracaoafetiva". */
export function normalizeTerm(q: string): string {
  return q
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 100);
}

export const STATUS_LABELS: Record<DiscoveryStatus, string> = {
  novo: 'Novo',
  salvo: 'Salvo',
  em_contato: 'Em contato',
  descartado: 'Descartado',
};

export const FOLLOWER_RANGES = [
  { key: 'todos', label: 'Qualquer', min: 0, max: Infinity },
  { key: 'micro', label: 'Até 10 mil', min: 0, max: 10_000 },
  { key: 'medio', label: '10 mil a 100 mil', min: 10_000, max: 100_000 },
  { key: 'grande', label: 'Mais de 100 mil', min: 100_000, max: Infinity },
] as const;

export interface ProfileFilter {
  followers: (typeof FOLLOWER_RANGES)[number]['key'];
  minPostsPerWeek: number;
  minEngagement: number;
  hideUnavailable: boolean;
}

export const DEFAULT_FILTER: ProfileFilter = { followers: 'todos', minPostsPerWeek: 0, minEngagement: 0, hideUnavailable: false };

/**
 * Filtros da tela. Perfis ainda não consultados (sem números) só passam quando o filtro numérico está em "qualquer",
 * para não esconder o que ainda não foi medido sem o usuário pedir.
 */
export function filterProfiles(list: DiscoveredProfile[], f: ProfileFilter): DiscoveredProfile[] {
  const range = FOLLOWER_RANGES.find((r) => r.key === f.followers) ?? FOLLOWER_RANGES[0];
  return list.filter((p) => {
    if (f.hideUnavailable && p.available === false) return false;
    if (range.key !== 'todos' && (p.followers == null || p.followers < range.min || p.followers >= range.max)) return false;
    if (f.minPostsPerWeek > 0 && (p.postsPerWeek ?? 0) < f.minPostsPerWeek) return false;
    if (f.minEngagement > 0 && (p.avgEngagement ?? 0) < f.minEngagement) return false;
    return true;
  });
}
