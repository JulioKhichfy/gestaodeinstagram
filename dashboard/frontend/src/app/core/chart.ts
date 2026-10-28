// Gráficos com Apache ECharts.
// Por que ECharts: um só pacote cobre linhas, barras empilhadas e mapa de calor (horário x dia), tem tooltip
// e legenda prontos, renderiza bem milhares de pontos e permite importar só os módulos usados (tree-shaking).
// Cores: paleta categórica validada para daltonismo (claro e escuro) definida em styles.scss (--series-N).
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { BarChart, HeatmapChart, LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent, VisualMapComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';

echarts.use([LineChart, BarChart, HeatmapChart, GridComponent, LegendComponent, TooltipComponent, VisualMapComponent, SVGRenderer]);

export interface ChartTheme {
  text: string;
  muted: string;
  grid: string;
  surface: string;
  series: string[];
  /** Rampa sequencial (claro -> escuro) para magnitude. */
  sequential: string[];
}

export interface ChartTable {
  columns: string[];
  rows: (string | number | null)[][];
}

function readTheme(): ChartTheme {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    text: v('--text'),
    muted: v('--muted'),
    grid: v('--border'),
    surface: v('--surface'),
    series: [1, 2, 3, 4, 5].map((n) => v(`--series-${n}`)),
    sequential: [v('--seq-low'), v('--seq-mid'), v('--seq-high')],
  };
}

/** Base comum: eixos e grade discretos, tooltip, legenda no topo. */
export function baseOption(t: ChartTheme): EChartsCoreOption {
  return {
    color: t.series,
    textStyle: { fontFamily: 'inherit', color: t.muted },
    grid: { left: 8, right: 16, top: 40, bottom: 8, containLabel: true },
    legend: { top: 0, left: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 12, textStyle: { color: t.text } },
    tooltip: {
      trigger: 'axis',
      backgroundColor: t.surface,
      borderColor: t.grid,
      textStyle: { color: t.text },
      axisPointer: { type: 'line', lineStyle: { color: t.muted, type: 'dashed' } },
    },
  };
}

export const axisStyle = (t: ChartTheme) => ({
  axisLine: { lineStyle: { color: t.grid } },
  axisTick: { show: false },
  axisLabel: { color: t.muted },
  splitLine: { lineStyle: { color: t.grid, type: 'dashed' as const } },
});

@Component({
  selector: 'app-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <figure class="chart-card">
      <figcaption>
        <div>
          <strong>{{ title() }}</strong>
          @if (subtitle()) { <small class="muted">{{ subtitle() }}</small> }
        </div>
        @if (table()) {
          <button type="button" class="link-btn" (click)="showTable.set(!showTable())">
            {{ showTable() ? 'Ver gráfico' : 'Ver tabela' }}
          </button>
        }
      </figcaption>
      @if (empty()) {
        <p class="muted empty">{{ emptyText() }}</p>
      }
      <div #host class="host" [style.height]="height()" [hidden]="showTable() || empty()"></div>
      @if (showTable() && table(); as t) {
        <div class="table-wrap" [style.max-height]="height()">
          <table class="data">
            <thead><tr>@for (c of t.columns; track $index) { <th>{{ c }}</th> }</tr></thead>
            <tbody>
              @for (r of t.rows; track $index) {
                <tr>@for (cell of r; track $index) { <td>{{ cell ?? '—' }}</td> }</tr>
              }
            </tbody>
          </table>
        </div>
      }
    </figure>
  `,
  styles: `
    .chart-card { margin: 0; display: grid; gap: 8px; min-width: 0; }
    figcaption { display: flex; justify-content: space-between; align-items: start; gap: 8px; }
    figcaption div { display: grid; }
    .host { width: 100%; min-width: 0; }
    .empty { padding: 32px 0; text-align: center; }
    .table-wrap { overflow: auto; }
  `,
})
export class Chart {
  readonly title = input('');
  readonly subtitle = input('');
  readonly height = input('260px');
  readonly empty = input(false);
  readonly emptyText = input('Sem dados no período. Sincronize a conta ou aguarde novas publicações.');
  /** Monta a opção do ECharts a partir do tema atual (claro/escuro). */
  readonly option = input.required<(t: ChartTheme) => EChartsCoreOption>();
  /** Visão em tabela (acessibilidade e leitura exata dos valores). */
  readonly table = input<ChartTable | null>(null);

  protected showTable = signal(false);
  private host = viewChild.required<ElementRef<HTMLDivElement>>('host');
  private chart: echarts.ECharts | null = null;
  private themeTick = signal(0);

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      this.chart = echarts.init(this.host().nativeElement, undefined, { renderer: 'svg' });
      const resize = new ResizeObserver(() => this.chart?.resize());
      resize.observe(this.host().nativeElement);
      const media = matchMedia('(prefers-color-scheme: dark)');
      const onScheme = () => this.themeTick.update((n) => n + 1);
      media.addEventListener('change', onScheme);
      this.render();
      destroyRef.onDestroy(() => {
        resize.disconnect();
        media.removeEventListener('change', onScheme);
        this.chart?.dispose();
      });
    });
    effect(() => {
      this.option();
      this.themeTick();
      this.empty();
      this.showTable();
      this.render();
    });
  }

  private render(): void {
    if (!this.chart) return;
    this.chart.setOption(this.option()(readTheme()), { notMerge: true });
    queueMicrotask(() => this.chart?.resize());
  }
}
