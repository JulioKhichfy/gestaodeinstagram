// Formatação pt-BR para números, percentuais, datas e variações.

const nf = new Intl.NumberFormat('pt-BR');
const nf1 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
const compactNf = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });

export const num = (n: number | null | undefined) => (n == null ? '—' : nf.format(n));
export const dec = (n: number | null | undefined) => (n == null ? '—' : nf1.format(n));
export const compact = (n: number | null | undefined) => (n == null ? '—' : compactNf.format(n));
export const pct = (n: number | null | undefined) => (n == null ? '—' : `${nf1.format(n)}%`);

export const dateBR = (iso: string | number | null | undefined) =>
  iso == null ? '—' : new Date(typeof iso === 'string' && iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('pt-BR');

export const dateTimeBR = (iso: string | number | null | undefined) =>
  iso == null
    ? '—'
    : new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });

/** "AAAA-MM-DD" -> "dd/mm" para eixos. */
export const shortDay = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

export const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export interface Delta {
  text: string;
  dir: 'up' | 'down' | 'flat';
}

/** Variação percentual entre o período atual e o anterior. */
export function delta(current: number | null | undefined, previous: number | null | undefined): Delta | null {
  if (current == null || previous == null || previous === 0) return null;
  const change = ((current - previous) / Math.abs(previous)) * 100;
  if (Math.abs(change) < 0.5) return { text: '0%', dir: 'flat' };
  return { text: `${change > 0 ? '+' : ''}${nf1.format(change)}%`, dir: change > 0 ? 'up' : 'down' };
}

export function todayIso(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
