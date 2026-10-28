import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { delta } from '../core/format';

/** Indicador com comparação ao período anterior. `inverse`: quando cair é bom. */
@Component({
  selector: 'app-kpi',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="kpi" [title]="hint()">
      <span class="label">{{ label() }}</span>
      <strong class="value">{{ value() }}</strong>
      @if (change(); as c) {
        <span class="delta" [class.good]="good()" [class.bad]="bad()">
          {{ c.dir === 'up' ? '▲' : c.dir === 'down' ? '▼' : '•' }} {{ c.text }}
          <span class="muted">vs período anterior</span>
        </span>
      } @else if (note()) {
        <span class="delta muted">{{ note() }}</span>
      }
    </div>
  `,
  styles: `
    .kpi { display: grid; gap: 2px; padding: 14px 16px; border: 1px solid var(--border); border-radius: 12px;
      background: var(--surface); min-width: 0; }
    .label { font-size: .8rem; color: var(--muted); }
    .value { font-size: 1.5rem; line-height: 1.2; font-variant-numeric: tabular-nums; }
    .delta { font-size: .78rem; color: var(--muted); }
    .delta.good { color: var(--ok-text); }
    .delta.bad { color: var(--error-text); }
    .delta .muted { margin-left: 2px; }
  `,
})
export class Kpi {
  readonly label = input.required<string>();
  readonly value = input.required<string>();
  readonly current = input<number | null | undefined>(null);
  readonly previous = input<number | null | undefined>(null);
  readonly inverse = input(false);
  readonly hint = input('');
  readonly note = input('');

  protected change = computed(() => delta(this.current(), this.previous()));
  protected good = computed(() => {
    const c = this.change();
    return !!c && c.dir !== 'flat' && (c.dir === 'up') !== this.inverse();
  });
  protected bad = computed(() => {
    const c = this.change();
    return !!c && c.dir !== 'flat' && !this.good();
  });
}
