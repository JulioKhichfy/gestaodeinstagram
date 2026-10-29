import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AccountsStore } from '../../core/accounts';
import { Api, CompareRow, errorMessage } from '../../core/api';
import { Chart, ChartTable, ChartTheme, axisStyle, baseOption } from '../../core/chart';
import { compact, dateBR, dec, delta, num, pct, shortDay } from '../../core/format';

@Component({
  selector: 'app-overview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Chart, RouterLink],
  template: `
    <div class="toolbar">
      <h1>Visão geral das contas</h1>
      <div class="segmented" aria-label="Período">
        @for (p of periods; track p) {
          <button title="Período comparado" type="button" [class.active]="days() === p" (click)="days.set(p)">{{ p }} dias</button>
        }
      </div>
      <button title="Busca posts e métricas novas de todas as contas" type="button" class="btn ghost" [disabled]="store.anySyncing()" (click)="syncAll()">
        {{ store.anySyncing() ? 'Sincronizando…' : 'Sincronizar todas' }}
      </button>
    </div>

    @if (error()) { <p class="alert error">{{ error() }}</p> }

    <section class="card">
      <h2>Alertas</h2>
      @for (row of rows(); track row.accountId) {
        @for (a of row.operational.alerts; track a.code) {
          <p class="alert" [class.error]="a.level === 'error'" [class.warn]="a.level === 'warn'" [class.info]="a.level === 'info'">
            <a [routerLink]="['/conta', row.accountId, 'relatorios']"><strong>&#64;{{ row.username }}</strong></a>: {{ a.text }}
          </p>
        }
      }
      @if (!hasAlerts()) { <p class="alert ok">Nenhum alerta. Todas as contas em dia.</p> }
    </section>

    <section class="card">
      <h2>Comparação ({{ days() }} dias vs {{ days() }} dias anteriores)</h2>
      <div class="table-scroll">
        <table class="data compare">
          <thead>
            <tr><th>Conta</th><th class="num">Seguidores</th><th class="num">Alcance</th><th class="num">Interações</th>
              <th class="num">Posts</th><th class="num">Posts/sem.</th><th class="num">Score médio</th><th class="num">Engaj. médio</th><th>Melhor formato</th><th class="num">Dias sem postar</th></tr>
          </thead>
          <tbody>
            @for (r of rows(); track r.accountId; let i = $index) {
              <tr>
                <td><span class="swatch" [style.background]="'var(--series-' + (i + 1) + ')'"></span>
                  <a [routerLink]="['/conta', r.accountId, 'relatorios']">{{ r.label }}</a><br /><small class="muted">&#64;{{ r.username }}</small></td>
                <td class="num">{{ fmt.num(r.kpis.followers) }}<br /><small class="muted">{{ signed(r.kpis.followersDelta) }}</small></td>
                <td class="num">{{ fmt.compact(r.kpis.reach) }}<br /><small [class]="cls(r.kpis.reach, r.prevKpis.reach)">{{ ch(r.kpis.reach, r.prevKpis.reach) }}</small></td>
                <td class="num">{{ fmt.compact(r.kpis.interactions) }}<br /><small [class]="cls(r.kpis.interactions, r.prevKpis.interactions)">{{ ch(r.kpis.interactions, r.prevKpis.interactions) }}</small></td>
                <td class="num">{{ r.kpis.posts }}</td>
                <td class="num">{{ fmt.dec(r.operational.postsPerWeek) }}</td>
                <td class="num">{{ fmt.dec(r.kpis.avgScore) }}<br /><small [class]="cls(r.kpis.avgScore, r.prevKpis.avgScore)">{{ ch(r.kpis.avgScore, r.prevKpis.avgScore) }}</small></td>
                <td class="num">{{ fmt.pct(r.kpis.avgEngagement) }}</td>
                <td>{{ bestFormat(r) }}</td>
                <td class="num">{{ fmt.num(r.operational.daysSinceLastPost) }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <p class="muted small">Score e engajamento são normalizados pelo alcance, então dá para comparar contas de tamanhos diferentes.</p>
    </section>

    <section class="grid-2">
      <div class="card"><app-chart title="Alcance por dia" [option]="reachChart()" [table]="reachTable()" [empty]="!hasDaily()" /></div>
      <div class="card"><app-chart title="Score médio dos posts" subtitle="Por conta, no período" [option]="scoreChart()" [empty]="!rows().length" /></div>
    </section>
  `,
  styles: `
    :host { display: grid; gap: 16px; }
    h1 { font-size: 1.3rem; margin: 0; flex: 1; }
    h2 { margin: 0 0 10px; font-size: 1.05rem; }
    .small { font-size: .82rem; }
    .swatch { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 6px; }
    small.up { color: var(--ok-text); }
    small.down { color: var(--error-text); }
    small.flat { color: var(--muted); }
  `,
})
export class OverviewPage {
  private api = inject(Api);
  protected store = inject(AccountsStore);

  protected readonly periods = [7, 30, 90];
  protected readonly fmt = { num, compact, dec, pct };
  protected days = signal(30);
  protected rows = signal<CompareRow[]>([]);
  protected error = signal('');

  protected hasAlerts = computed(() => this.rows().some((r) => r.operational.alerts.length));
  protected hasDaily = computed(() => this.rows().some((r) => r.daily.some((d) => d.reach != null)));

  constructor() {
    effect(() => {
      const d = this.days();
      this.store.dataVersion();
      untracked(() => this.load(d));
    });
  }

  private async load(days: number): Promise<void> {
    try {
      this.rows.set(await this.api.compare(days));
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  async syncAll(): Promise<void> {
    await this.api.syncAll().catch(() => undefined);
    this.store.watchSync();
  }

  ch(cur: number | null, prev: number | null): string {
    return delta(cur, prev)?.text ?? '';
  }
  cls(cur: number | null, prev: number | null): string {
    return delta(cur, prev)?.dir ?? '';
  }
  signed(n: number | null): string {
    return n == null ? '' : `${n >= 0 ? '+' : ''}${num(n)}`;
  }
  bestFormat(r: CompareRow): string {
    const f = r.byFormat.filter((x) => x.avgScore != null).sort((a, b) => b.avgScore! - a.avgScore!)[0];
    return f ? `${f.label} (${dec(f.avgScore)})` : '—';
  }

  /** Datas unificadas para todas as contas (cor fixa por conta, na ordem das abas). */
  private dates = computed(() => [...new Set(this.rows().flatMap((r) => r.daily.map((d) => d.date)))].sort());

  protected reachChart = computed(() => {
    const rows = this.rows();
    const dates = this.dates();
    return (t: ChartTheme) => ({
      ...baseOption(t),
      xAxis: { type: 'category', data: dates.map(shortDay), boundaryGap: false, ...axisStyle(t), splitLine: { show: false } },
      yAxis: { type: 'value', ...axisStyle(t), axisLabel: { color: t.muted, formatter: (v: number) => compact(v) } },
      series: rows.map((r) => {
        const byDate = new Map(r.daily.map((d) => [d.date, d.reach]));
        return {
          name: r.label,
          type: 'line',
          showSymbol: false,
          lineStyle: { width: 2 },
          data: dates.map((d) => byDate.get(d) ?? null),
          endLabel: { show: true, formatter: '{a}', color: t.text },
        };
      }),
      grid: { left: 8, right: 120, top: 40, bottom: 8, containLabel: true },
    });
  });
  protected reachTable = computed<ChartTable>(() => {
    const rows = this.rows();
    return {
      columns: ['Dia', ...rows.map((r) => r.label)],
      rows: this.dates().map((d) => [dateBR(d), ...rows.map((r) => r.daily.find((x) => x.date === d)?.reach ?? null)]),
    };
  });

  protected scoreChart = computed(() => {
    const rows = this.rows();
    return (t: ChartTheme) => ({
      ...baseOption(t),
      legend: { show: false },
      tooltip: { ...(baseOption(t)['tooltip'] as object), axisPointer: { type: 'shadow' } },
      xAxis: { type: 'category', data: rows.map((r) => r.label), ...axisStyle(t), splitLine: { show: false } },
      yAxis: { type: 'value', ...axisStyle(t) },
      series: [
        {
          name: 'Score médio',
          type: 'bar',
          barMaxWidth: 40,
          data: rows.map((r, i) => ({ value: r.kpis.avgScore, itemStyle: { color: t.series[i], borderRadius: [4, 4, 0, 0] } })),
          label: { show: true, position: 'top', color: t.text, formatter: (p: { value: number | null }) => dec(p.value) },
        },
      ],
    });
  });
}
