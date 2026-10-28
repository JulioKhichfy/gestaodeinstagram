import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AccountsStore } from '../../core/accounts';
import { Api, Post, Report, errorMessage } from '../../core/api';
import { Chart, ChartTable, ChartTheme, axisStyle, baseOption } from '../../core/chart';
import { WEEKDAYS, compact, dateBR, dateTimeBR, dec, downloadBlob, num, pct, shortDay } from '../../core/format';
import { ClaudePanel } from '../../shared/claude-panel';
import { Kpi } from '../../shared/kpi';

const SIGNALS = [
  { key: 'shares', label: 'Compartilhamentos' },
  { key: 'saved', label: 'Salvamentos' },
  { key: 'comments', label: 'Comentários' },
  { key: 'likes', label: 'Curtidas' },
  { key: 'profile_visits', label: 'Visitas ao perfil' },
] as const;

@Component({
  selector: 'app-reports',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Chart, Kpi, ClaudePanel, RouterLink],
  templateUrl: './reports.html',
  styleUrl: './reports.scss',
})
export class ReportsPage {
  private api = inject(Api);
  private store = inject(AccountsStore);

  readonly id = input.required<string>();

  protected days = signal(30);
  protected report = signal<Report | null>(null);
  protected loading = signal(false);
  protected error = signal('');
  protected tab = signal<'estrategico' | 'operacional'>('estrategico');
  protected account = computed(() => this.store.byId(this.id()));

  protected readonly fmt = { num, compact, pct, dec, dateBR, dateTimeBR };
  protected readonly periods = [7, 30, 90];

  constructor() {
    effect(() => {
      const id = this.id();
      const d = this.days();
      this.store.dataVersion();
      untracked(() => this.load(id, d));
    });
  }

  private async load(id: string, days: number): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      this.report.set(await this.api.report(id, days));
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  protected hasData = computed(() => {
    const r = this.report();
    return !!r && (r.daily.length > 0 || r.topPosts.length > 0 || r.byFormat.length > 0);
  });

  // ---------- Leituras automáticas ----------

  protected insights = computed(() => {
    const r = this.report();
    if (!r) return [];
    const out: string[] = [];
    const formats = r.byFormat.filter((f) => f.posts >= 2 && f.avgScore != null).sort((a, b) => b.avgScore! - a.avgScore!);
    if (formats.length >= 2) {
      out.push(
        `${formats[0].label} é o formato com melhor score médio (${dec(formats[0].avgScore)} vs ${dec(formats.at(-1)!.avgScore)} de ${formats.at(-1)!.label}).`,
      );
    }
    const days = r.byWeekday.filter((d) => d.posts >= 2 && d.avgScore != null).sort((a, b) => b.avgScore! - a.avgScore!);
    if (days.length >= 2) out.push(`Seus posts de ${WEEKDAYS[days[0].weekday]} têm o melhor desempenho médio.`);
    if (r.online.some(Boolean)) {
      const top = r.online.map((v, h) => ({ v, h })).sort((a, b) => b.v - a.v).slice(0, 3).map((x) => `${x.h}h`);
      out.push(`Seus seguidores estão mais online por volta de ${top.join(', ')}: publique 30-60 min antes.`);
    }
    const weeks = r.signalsByWeek;
    if (weeks.length >= 4) {
      const strong = (w: (typeof weeks)[number]) => w.shares + w.saved;
      const total = (w: (typeof weeks)[number]) => w.shares + w.saved + w.comments + w.likes + w.profile_visits || 1;
      const share = (ws: typeof weeks) => ws.reduce((a, w) => a + strong(w), 0) / ws.reduce((a, w) => a + total(w), 0);
      const recent = share(weeks.slice(-2));
      const before = share(weeks.slice(-4, -2));
      out.push(
        recent >= before
          ? `Compartilhamentos + salvamentos são ${pct(recent * 100)} das interações recentes (subindo): o conteúdo está ficando mais “recomendável”.`
          : `Compartilhamentos + salvamentos caíram para ${pct(recent * 100)} das interações: teste conteúdos mais úteis (listas, passo a passo) ou que as pessoas queiram enviar.`,
      );
    }
    const freq = r.operational.postsPerWeek;
    if (freq < 3) out.push(`Frequência de ${dec(freq)} post(s)/semana: contas que crescem costumam manter 3 a 5 por semana, com pelo menos 2 Reels.`);
    return out;
  });

  /** Resumo em texto do relatório para o Claude analisar. */
  protected summary = computed(() => {
    const r = this.report();
    if (!r) return '';
    const k = r.kpis;
    const p = r.prevKpis;
    const post = (x: Post) => `${x.formatLabel} de ${dateBR(x.timestamp)} (score ${dec(x.score)}, alcance ${num(x.reach)}): ${x.caption.slice(0, 120)}`;
    return [
      `Período: últimos ${r.period.days} dias (${dateBR(r.period.from)} a ${dateBR(r.period.to)}), comparado aos ${r.period.days} dias anteriores.`,
      `Alcance: ${num(k.reach)} (antes ${num(p.reach)}). Interações: ${num(k.interactions)} (antes ${num(p.interactions)}).`,
      `Seguidores: ${num(k.followers)} (variação ${num(k.followersDelta)}). Posts: ${k.posts} (antes ${p.posts}). Score médio: ${dec(k.avgScore)} (antes ${dec(p.avgScore)}).`,
      `Por formato: ${r.byFormat.map((f) => `${f.label} ${f.posts} posts, score ${dec(f.avgScore)}, alcance médio ${num(f.avgReach)}`).join('; ')}.`,
      `Melhores posts: ${r.topPosts.slice(0, 3).map(post).join(' | ')}`,
      `Piores posts: ${r.bottomPosts.slice(0, 3).map(post).join(' | ')}`,
      `Frequência: ${dec(r.operational.postsPerWeek)} posts/semana. Leituras: ${this.insights().join(' ')}`,
    ].join('\n');
  });

  // ---------- Gráficos ----------

  protected reachChart = computed(() => {
    const d = this.report()?.daily ?? [];
    return (t: ChartTheme) => ({
      ...baseOption(t),
      legend: { show: false },
      xAxis: { type: 'category', data: d.map((x) => shortDay(x.date)), boundaryGap: false, ...axisStyle(t), splitLine: { show: false } },
      yAxis: { type: 'value', ...axisStyle(t), axisLabel: { color: t.muted, formatter: (v: number) => compact(v) } },
      series: [
        { name: 'Alcance', type: 'line', data: d.map((x) => x.reach), showSymbol: false, lineStyle: { width: 2 }, areaStyle: { opacity: 0.08 } },
      ],
    });
  });
  protected reachTable = computed<ChartTable>(() => ({
    columns: ['Dia', 'Alcance', 'Visualizações', 'Interações', 'Contas engajadas'],
    rows: (this.report()?.daily ?? []).map((x) => [dateBR(x.date), x.reach, x.views, x.total_interactions, x.accounts_engaged]),
  }));

  protected followersChart = computed(() => {
    const d = (this.report()?.daily ?? []).filter((x) => x.followers != null);
    return (t: ChartTheme) => ({
      ...baseOption(t),
      legend: { show: false },
      xAxis: { type: 'category', data: d.map((x) => shortDay(x.date)), boundaryGap: false, ...axisStyle(t), splitLine: { show: false } },
      yAxis: { type: 'value', scale: true, ...axisStyle(t), axisLabel: { color: t.muted, formatter: (v: number) => compact(v) } },
      series: [{ name: 'Seguidores', type: 'line', data: d.map((x) => x.followers), showSymbol: d.length < 15, symbolSize: 8, lineStyle: { width: 2 } }],
    });
  });

  protected signalsChart = computed(() => {
    const w = this.report()?.signalsByWeek ?? [];
    return (t: ChartTheme) => ({
      ...baseOption(t),
      xAxis: { type: 'category', data: w.map((x) => `sem. ${shortDay(x.week)}`), ...axisStyle(t), splitLine: { show: false } },
      yAxis: { type: 'value', ...axisStyle(t), axisLabel: { color: t.muted, formatter: (v: number) => compact(v) } },
      tooltip: { ...(baseOption(t)['tooltip'] as object), axisPointer: { type: 'shadow' } },
      series: SIGNALS.map((s, i) => ({
        name: s.label,
        type: 'bar',
        stack: 'sinais',
        barMaxWidth: 36,
        data: w.map((x) => x[s.key]),
        // 2px de superfície entre os segmentos; topo arredondado só no último.
        itemStyle: { borderColor: t.surface, borderWidth: 1, borderRadius: i === SIGNALS.length - 1 ? [4, 4, 0, 0] : 0 },
      })),
    });
  });
  protected signalsTable = computed<ChartTable>(() => ({
    columns: ['Semana', 'Posts', ...SIGNALS.map((s) => s.label)],
    rows: (this.report()?.signalsByWeek ?? []).map((w) => [dateBR(w.week), w.posts, ...SIGNALS.map((s) => w[s.key])]),
  }));

  protected formatChart = computed(() => {
    const f = this.report()?.byFormat ?? [];
    return (t: ChartTheme) => ({
      ...baseOption(t),
      legend: { show: false },
      tooltip: { ...(baseOption(t)['tooltip'] as object), axisPointer: { type: 'shadow' } },
      xAxis: { type: 'value', ...axisStyle(t) },
      yAxis: { type: 'category', data: f.map((x) => `${x.label} (${x.posts})`), ...axisStyle(t), splitLine: { show: false } },
      series: [
        {
          name: 'Score médio',
          type: 'bar',
          barMaxWidth: 24,
          data: f.map((x) => x.avgScore),
          itemStyle: { borderRadius: [0, 4, 4, 0] },
          label: { show: true, position: 'right', color: t.text, formatter: (p: { value: number }) => dec(p.value) },
        },
      ],
    });
  });
  protected formatTable = computed<ChartTable>(() => ({
    columns: ['Formato', 'Posts', 'Score médio', 'Alcance médio', 'Compart. médios', 'Salv. médios', 'Engajamento'],
    rows: (this.report()?.byFormat ?? []).map((f) => [f.label, f.posts, dec(f.avgScore), num(f.avgReach), dec(f.avgShares), dec(f.avgSaves), pct(f.avgEngagement)]),
  }));

  protected weekdayChart = computed(() => {
    const w = this.report()?.byWeekday ?? [];
    return (t: ChartTheme) => ({
      ...baseOption(t),
      legend: { show: false },
      tooltip: { ...(baseOption(t)['tooltip'] as object), axisPointer: { type: 'shadow' } },
      xAxis: { type: 'category', data: w.map((x) => WEEKDAYS[x.weekday]), ...axisStyle(t), splitLine: { show: false } },
      yAxis: { type: 'value', ...axisStyle(t) },
      series: [{ name: 'Score médio', type: 'bar', barMaxWidth: 32, data: w.map((x) => x.avgScore), itemStyle: { borderRadius: [4, 4, 0, 0] } }],
    });
  });
  protected weekdayTable = computed<ChartTable>(() => ({
    columns: ['Dia', 'Posts', 'Score médio', 'Alcance médio'],
    rows: (this.report()?.byWeekday ?? []).map((w) => [WEEKDAYS[w.weekday], w.posts, dec(w.avgScore), num(w.avgReach)]),
  }));

  protected hasOnline = computed(() => (this.report()?.online ?? []).some((v) => v > 0));

  protected onlineChart = computed(() => {
    const o = this.report()?.online ?? [];
    return (t: ChartTheme) => ({
      ...baseOption(t),
      legend: { show: false },
      tooltip: { ...(baseOption(t)['tooltip'] as object), axisPointer: { type: 'shadow' } },
      xAxis: { type: 'category', data: o.map((_, h) => `${h}h`), ...axisStyle(t), splitLine: { show: false } },
      yAxis: { type: 'value', ...axisStyle(t), axisLabel: { color: t.muted, formatter: (v: number) => compact(v) } },
      series: [{ name: 'Seguidores online (média)', type: 'bar', barMaxWidth: 18, data: o, itemStyle: { borderRadius: [4, 4, 0, 0] } }],
    });
  });

  protected demographics = computed(() => {
    const d = this.report()?.demographics ?? [];
    const pick = (breakdown: string, audience = 'followers', limit = 8) =>
      d.filter((x) => x.audience === audience && x.breakdown === breakdown).slice(0, limit);
    const age = pick('age', 'followers', 10).sort((a, b) => a.key.localeCompare(b.key));
    const gender = pick('gender');
    const total = gender.reduce((a, g) => a + g.value, 0) || 1;
    return {
      age,
      gender: gender.map((g) => ({ label: g.key === 'F' ? 'Mulheres' : g.key === 'M' ? 'Homens' : 'Não informado', pct: (g.value / total) * 100 })),
      cities: pick('city'),
      engagedCities: pick('city', 'engaged'),
    };
  });
  protected ageChart = computed(() => {
    const age = this.demographics().age;
    return (t: ChartTheme) => ({
      ...baseOption(t),
      legend: { show: false },
      tooltip: { ...(baseOption(t)['tooltip'] as object), axisPointer: { type: 'shadow' } },
      xAxis: { type: 'category', data: age.map((a) => a.key), ...axisStyle(t), splitLine: { show: false } },
      yAxis: { type: 'value', ...axisStyle(t) },
      series: [{ name: 'Seguidores', type: 'bar', barMaxWidth: 32, data: age.map((a) => a.value), itemStyle: { borderRadius: [4, 4, 0, 0] } }],
    });
  });

  async exportCsv(): Promise<void> {
    const r = this.report();
    const blob = await this.api.postsCsv(this.id(), r ? { from: r.period.from, to: r.period.to } : {});
    downloadBlob(blob, `posts-${this.id()}-${r?.period.from ?? ''}.csv`);
  }

  async sync(): Promise<void> {
    await this.api.syncAccount(this.id()).catch(() => undefined);
    this.store.watchSync();
  }
}
