import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api, GenJob, GenKind, Pauta, errorMessage } from '../../core/api';
import { GEN_KIND_LABELS, STEP_LABELS } from './post-generator';

interface Row extends Pauta {
  checked: boolean;
}

/**
 * Raio-X: conteúdo histórico em séries (linha do tempo, ídolos, jogos, gols, curiosidades…). O Claude sugere
 * pautas; as escolhidas viram rascunhos pelo gerador, com a regra de marcar [CONFERIR] onde houver dúvida.
 */
@Component({
  selector: 'app-raio-x',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <section class="card">
      <h2>Raio-X</h2>
      <p class="muted small">Escolha uma série. O Claude sugere pautas; marque as que quer e gere os posts. Datas, placares e nomes
        em dúvida saem com <strong>[CONFERIR]</strong>: cheque antes de publicar (a credibilidade da página depende disso).</p>
      <div class="series" role="radiogroup" aria-label="Série">
        @for (s of series(); track s) {
          <button type="button" role="radio" [attr.aria-checked]="serie() === s" [class.active]="serie() === s"
                  title="Escolher esta série" (click)="pick(s)">{{ s }}</button>
        }
      </div>
      <div class="actions">
        <button type="button" class="btn primary" [disabled]="!serie() || busy()" (click)="suggest()"
                title="O Claude sugere 8 pautas para a série escolhida (leva uns 20 s)">
          @if (busy() === 'suggest') { <span class="spinner"></span> Pensando… } @else { Sugerir pautas }
        </button>
      </div>
      @if (error()) { <p class="alert error">{{ error() }}</p> }
    </section>

    @if (rows().length && !job()) {
      <section class="card">
        <h3>Pautas: {{ serie() }}</h3>
        <ul class="pautas">
          @for (r of rows(); track $index; let i = $index) {
            <li>
              <label class="check" title="Marcar para gerar">
                <input type="checkbox" [checked]="r.checked" (change)="toggle(i, $any($event.target).checked)" />
                <span><strong>{{ r.theme }}</strong>@if (r.description) { <small class="muted"> · {{ r.description }}</small> }</span>
              </label>
              <select [value]="r.kind" (change)="setKind(i, $any($event.target).value)" aria-label="Formato" title="Formato do post">
                @for (k of kinds; track k) { <option [value]="k">{{ kindLabels[k] }}</option> }
              </select>
            </li>
          }
        </ul>
        <div class="actions">
          <button type="button" class="btn primary" [disabled]="!checked() || busy()" (click)="generate()"
                  title="Cria os rascunhos: Claude escreve, Jev revisa e guia a reescrita">
            @if (busy() === 'generate') { <span class="spinner"></span> } Gerar {{ checked() }} post(s)
          </button>
        </div>
      </section>
    }

    @if (job(); as j) {
      <section class="card">
        <h3>Gerando: {{ serie() }}</h3>
        <ul class="progress">
          @for (item of j.items; track $index) {
            <li>
              <span><strong>{{ item.title || item.theme }}</strong> <small class="muted">{{ kindLabels[item.kind] }}</small></span>
              <span>
                {{ steps[item.step] }}@if (item.grades.length) { · Jev {{ item.grades.join(' → ') }} }
                @if (item.draftId) { · <a [routerLink]="['..', 'rascunhos']" [queryParams]="{ abrir: item.draftId }">abrir rascunho</a> }
              </span>
              @if (item.error) { <small class="error-text">{{ item.error }}</small> }
            </li>
          }
        </ul>
        @if (j.done) {
          <div class="actions"><button type="button" class="btn ghost" (click)="reset()" title="Escolher outra série ou outras pautas">Gerar mais</button></div>
        }
      </section>
    }
  `,
  styles: `
    :host { display: grid; gap: 12px; }
    h2 { margin: 0 0 4px; font-size: 1.1rem; }
    h3 { margin: 0 0 8px; font-size: 1rem; }
    .small { font-size: .85rem; margin: 0; }
    .series { display: flex; gap: 6px; flex-wrap: wrap; margin: 10px 0;
      button { border: 1px solid var(--border); background: var(--surface); border-radius: 999px; padding: 6px 12px; cursor: pointer; font: inherit; color: inherit; }
      button.active { background: var(--accent); color: #fff; border-color: var(--accent); } }
    .actions { display: flex; justify-content: flex-end; gap: 8px; }
    .pautas, .progress { list-style: none; margin: 0 0 10px; padding: 0; display: grid; gap: 8px;
      li { display: flex; justify-content: space-between; gap: 10px; align-items: center; flex-wrap: wrap;
        border-bottom: 1px solid var(--border); padding-bottom: 8px; } }
    .check { display: flex; gap: 8px; align-items: start; flex: 1; min-width: 240px; }
    .error-text { color: var(--danger, #c0392b); width: 100%; }
  `,
})
export class RaioXPage {
  private api = inject(Api);

  readonly id = input.required<string>();

  protected readonly kinds = Object.keys(GEN_KIND_LABELS) as GenKind[];
  protected readonly kindLabels = GEN_KIND_LABELS;
  protected readonly steps = STEP_LABELS;

  protected series = signal<string[]>([]);
  protected serie = signal('');
  protected rows = signal<Row[]>([]);
  protected busy = signal<'suggest' | 'generate' | null>(null);
  protected error = signal('');
  protected job = signal<GenJob | null>(null);
  protected checked = computed(() => this.rows().filter((r) => r.checked).length);
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() =>
        this.api
          .radarSeries(id)
          .then((s) => this.series.set(s))
          .catch((e) => this.error.set(errorMessage(e))),
      );
    });
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
  }

  pick(s: string): void {
    this.serie.set(s);
    this.rows.set([]);
  }

  toggle(i: number, checked: boolean): void {
    this.rows.update((rows) => rows.map((r, n) => (n === i ? { ...r, checked } : r)));
  }

  setKind(i: number, kind: GenKind): void {
    this.rows.update((rows) => rows.map((r, n) => (n === i ? { ...r, kind } : r)));
  }

  async suggest(): Promise<void> {
    this.busy.set('suggest');
    this.error.set('');
    try {
      const pautas = await this.api.suggestPautas(this.id(), this.serie());
      this.rows.set(pautas.map((p) => ({ ...p, checked: true })));
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(null);
    }
  }

  async generate(): Promise<void> {
    this.busy.set('generate');
    this.error.set('');
    try {
      const items = this.rows()
        .filter((r) => r.checked)
        .map((r) => ({ theme: r.theme, kind: r.kind }));
      this.job.set(await this.api.generatePautas(this.id(), this.serie(), items));
      this.poll();
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(null);
    }
  }

  private poll(): void {
    this.timer = setTimeout(async () => {
      const current = this.job();
      if (!current) return;
      try {
        const job = await this.api.generateJob(current.id);
        this.job.set(job);
        if (!job.done) this.poll();
      } catch (e) {
        this.error.set(errorMessage(e));
      }
    }, 2000);
  }

  reset(): void {
    this.job.set(null);
    this.rows.set([]);
  }
}
