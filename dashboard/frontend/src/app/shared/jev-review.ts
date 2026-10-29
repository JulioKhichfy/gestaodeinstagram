import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { Api, CaptionReview, errorMessage } from '../core/api';

/** Faixas da nota da legenda (0 a 100). */
export function gradeLabel(grade: number): string {
  return grade >= 75 ? 'Pronta para publicar' : grade >= 50 ? 'Dá para melhorar' : 'Precisa de ajustes';
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

/**
 * "Revisar com o Jev": avaliação rápida da legenda (gancho, clareza, chamada para ação, tom da marca),
 * com nota composta, dicas e gancho/estilo sugeridos. O Jev não reescreve: para isso existe o Claude.
 */
@Component({
  selector: 'app-jev-review',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="jev">
      <header>
        <span class="mark" aria-hidden="true">◆</span>
        <strong>Revisar com o Jev</strong>
        <small class="muted">avaliação em segundos · não reescreve o texto</small>
        <span class="spacer"></span>
        @if (configured() !== false) {
          <button title="O Jev dá nota de 0 a 100 para gancho, clareza, chamada para ação e tom (não altera o texto)" type="button" class="btn ghost" [disabled]="busy() || !caption().trim()" (click)="review()">
            @if (busy()) { <span class="spinner"></span> Avaliando… } @else { {{ result() ? 'Revisar de novo' : 'Revisar legenda' }} }
          </button>
        }
      </header>

      @if (configured() === false) {
        <p class="muted small">Jev desligado: coloque <code>TYPESAFE_API_KEY</code> no <code>backend/.env</code> e reinicie o backend.</p>
      }
      @if (error()) { <p class="alert error">{{ error() }}</p> }

      @if (result(); as r) {
        @if (stale()) { <p class="muted small">O texto mudou desde a última revisão.</p> }
        <div class="grade">
          <strong class="hero">{{ r.grade }}</strong><span class="muted">/100</span>
          <span class="verdict">{{ label(r.grade) }}</span>
        </div>

        <div class="dims">
          @for (d of r.dimensions; track d.key) {
            <div class="dim" [title]="d.level">
              <span>{{ d.label }} <small class="muted">· peso {{ d.weight }}</small></span>
              <span class="bar" role="img" [attr.aria-label]="d.label + ': ' + pct(d.value)"><span [style.width.%]="d.value * 100"></span></span>
              <span class="num">{{ pct(d.value) }}</span>
              <small class="level muted">{{ d.level }}@if (d.uncertain) { · <em>Jev em dúvida</em> }</small>
            </div>
          }
        </div>

        <ul class="facts">
          <li>Objetivo: <strong>{{ r.objective.label }}</strong> <small class="muted">({{ pct(r.objective.confidence) }})</small></li>
          @if (r.hook) { <li>Gancho: <strong>{{ r.hook.label }}</strong> <small class="muted">({{ pct(r.hook.confidence) }})</small></li> }
          @if (r.style) { <li>Estilo: <strong>{{ r.style.label }}</strong> <small class="muted">({{ pct(r.style.confidence) }})</small></li> }
          @if (!r.toneEvaluated) { <li class="muted">Tom da marca não avaliado: a conta não tem claude.md.</li> }
        </ul>

        @for (w of r.warnings; track w) { <p class="alert warn">⚠ {{ w }}</p> }
        @if (r.tips.length) {
          <ul class="tips">@for (t of r.tips; track t) { <li>{{ t }}</li> }</ul>
        }

        @if (offerTags() && (r.hook || r.style)) {
          <div class="row end">
            <button title="Preenche gancho e estilo do rascunho com o que o Jev identificou" type="button" class="btn ghost" (click)="tags.emit({ hook: r.hook?.value ?? null, style: r.style?.value ?? null })">
              Usar gancho e estilo sugeridos
            </button>
          </div>
        }
      }
    </section>
  `,
  styles: `
    .jev { display: grid; gap: 10px; border: 1px solid var(--border); border-radius: 12px; padding: 14px; background: var(--surface-2); }
    header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .mark { color: var(--series-1); }
    .spacer { flex: 1; }
    .small { font-size: .85rem; margin: 0; }
    .grade { display: flex; align-items: baseline; gap: 6px; }
    .hero { font-size: 2rem; line-height: 1; }
    .verdict { margin-left: 8px; font-weight: 600; }
    .dims { display: grid; gap: 8px; }
    .dim { display: grid; grid-template-columns: 170px 1fr 44px; gap: 4px 8px; align-items: center; font-size: .88rem; }
    .level { grid-column: 1 / -1; font-size: .78rem; }
    .bar { height: 8px; background: var(--border); border-radius: 4px; overflow: hidden;
      span { display: block; height: 100%; background: var(--series-1); border-radius: 4px; } }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .facts { display: flex; flex-wrap: wrap; gap: 4px 16px; list-style: none; padding: 0; margin: 0; font-size: .88rem; }
    .tips { margin: 0; padding-left: 18px; display: grid; gap: 4px; font-size: .9rem; }
    .row.end { display: flex; justify-content: flex-end; }
    @media (max-width: 520px) { .dim { grid-template-columns: 1fr 44px; } .bar { grid-column: 1 / -1; grid-row: 2; } }
  `,
})
export class JevReview {
  private api = inject(Api);

  readonly accountId = input.required<string>();
  readonly caption = input('');
  /** image | carousel | reel | story */
  readonly kind = input('');
  /** Mostra o botão para aplicar gancho/estilo (rascunhos). */
  readonly offerTags = input(false);
  readonly tags = output<{ hook: string | null; style: string | null }>();

  protected readonly pct = pct;
  protected readonly label = gradeLabel;
  protected configured = signal<boolean | null>(null);
  protected busy = signal(false);
  protected error = signal('');
  protected result = signal<CaptionReview | null>(null);
  private reviewed = signal('');
  protected stale = computed(() => !!this.result() && this.reviewed() !== this.caption());

  constructor() {
    this.api
      .jevStatus()
      .then((s) => this.configured.set(s.configured))
      .catch(() => this.configured.set(null));
  }

  async review(): Promise<void> {
    const caption = this.caption();
    if (this.busy() || !caption.trim()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      this.result.set(await this.api.reviewCaption(this.accountId(), { caption, kind: this.kind() }));
      this.reviewed.set(caption);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
