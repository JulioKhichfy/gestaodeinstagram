import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { Api, GenItem, GenJob, GenKind, GenStatus, GenStep, errorMessage } from '../../core/api';

export const GEN_KIND_LABELS: Record<GenKind, string> = { image: 'Post estático', carousel: 'Carrossel', reel: 'Reels' };

export const STEP_LABELS: Record<GenStep, string> = {
  fila: 'Na fila',
  escrevendo: 'Claude escrevendo…',
  revisando: 'Jev avaliando…',
  reescrevendo: 'Claude reescrevendo com as dicas do Jev…',
  midia: 'Buscando fotos e vídeos…',
  pronto: 'Pronto',
  erro: 'Erro',
};

interface Row {
  key: number;
  kind: GenKind;
  theme: string;
}

/**
 * "Gerar posts": de 1 a N temas. Para cada um, o Claude escreve, o Jev avalia e guia reescritas, e um banco de
 * imagens gratuito sugere a mídia. Tudo vira rascunho; publicar continua sendo decisão de quem usa o dashboard.
 */
@Component({
  selector: 'app-post-generator',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="gen">
      <header>
        <h2>Gerar posts</h2>
        <button title="Volta para os rascunhos (a geração continua no backend)" type="button" class="btn ghost" (click)="closed.emit()">Fechar</button>
      </header>

      @if (!job()) {
        <p class="muted small">Escreva o tema de cada post. O Claude escreve, o Jev avalia a legenda (e, se a nota ficar abaixo
          de {{ status()?.target ?? 75 }}, o Claude reescreve seguindo as dicas dele) e um banco de imagens gratuito sugere fotos ou vídeos.
          Tudo vira rascunho: você revisa e decide o que publicar.</p>

        @for (row of rows(); track row.key; let i = $index) {
          <div class="gen-row">
            <select [value]="row.kind" (change)="update(i, { kind: $any($event.target).value })" [attr.aria-label]="'Formato do post ' + (i + 1)">
              @for (k of kinds; track k) { <option [value]="k">{{ kindLabels[k] }}</option> }
            </select>
            <textarea rows="2" [value]="row.theme" (input)="update(i, { theme: $any($event.target).value })"
                      [attr.aria-label]="'Tema do post ' + (i + 1)"
                      placeholder="Tema. Ex.: 3 erros que deixam a sala pequena apertada"></textarea>
            <button type="button" class="btn ghost" (click)="remove(i)" [disabled]="rows().length === 1" aria-label="Remover este post">✕</button>
          </div>
        }
        <button title="Mais um tema (até 10 por vez)" type="button" class="btn ghost add" (click)="add()" [disabled]="rows().length >= max()">＋ Adicionar outro post</button>

        <label class="check">
          <input type="checkbox" [checked]="rewrite()" [disabled]="!status()?.jev" (change)="rewrite.set($any($event.target).checked)" />
          Reescrever com o Claude até o Jev dar nota {{ status()?.target ?? 75 }} (até {{ status()?.maxRewrites ?? 2 }} vezes)
        </label>
        @if (status() && !status()!.jev) { <small class="muted">Jev desligado (sem TYPESAFE_API_KEY): o texto sai sem avaliação.</small> }
        <label class="check">
          <input type="checkbox" [checked]="media()" [disabled]="!status()?.stock" (change)="media.set($any($event.target).checked)" />
          Sugerir fotos e vídeos gratuitos{{ status()?.stockLabel ? ' do ' + status()!.stockLabel : '' }}
        </label>
        @if (status() && !status()!.stock) {
          <small class="muted">Para ligar: crie uma chave grátis em pixabay.com/api/docs e coloque <code>PIXABAY_API_KEY=</code> no <code>backend/.env</code>.</small>
        }

        @if (error()) { <p class="alert error">{{ error() }}</p> }
        <div class="actions">
          <button title="Claude escreve, Jev avalia e guia a reescrita, banco de imagens sugere fotos; tudo vira rascunho" type="button" class="btn primary" [disabled]="busy() || !ready()" (click)="start()">
            @if (busy()) { <span class="spinner"></span> Enviando… } @else { Gerar {{ ready() }} post(s) }
          </button>
        </div>
      } @else {
        <ul class="progress">
          @for (item of job()!.items; track $index) {
            <li [class.err]="item.step === 'erro'">
              <div class="line">
                <strong>{{ item.title || item.theme }}</strong>
                <small class="muted">{{ kindLabels[item.kind] }}</small>
              </div>
              <div class="line">
                <span>
                  @if (active(item)) { <span class="spinner inline"></span> }
                  {{ stepLabel(item) }}
                  @if (item.grades.length) { · nota do Jev: {{ item.grades.join(' → ') }} }
                </span>
                @if (item.draftId) {
                  <button title="Abre o rascunho para revisar texto e mídias" type="button" class="btn ghost" (click)="open.emit(item.draftId!)">Abrir rascunho</button>
                }
              </div>
              @if (item.error) { <small class="error-text">{{ item.error }}</small> }
              @for (n of item.notes; track n) { <small class="muted">{{ n }}</small> }
            </li>
          }
        </ul>
        @if (error()) { <p class="alert error">{{ error() }}</p> }
        @if (job()!.done) {
          <div class="actions">
            <button title="Começa uma nova lista de temas" type="button" class="btn ghost" (click)="reset()">Gerar outros</button>
          </div>
        } @else {
          <p class="muted small">Pode navegar pelo dashboard: a geração continua no backend. Cada post leva cerca de 30 s a 2 min.</p>
        }
      }
    </section>
  `,
  styles: `
    .gen { display: grid; gap: 10px; }
    header { display: flex; justify-content: space-between; align-items: center; }
    h2 { margin: 0; font-size: 1.1rem; }
    .small { font-size: .85rem; margin: 0; }
    .gen-row { display: grid; grid-template-columns: 150px 1fr auto; gap: 8px; align-items: start; }
    .add { justify-self: start; }
    .check { display: flex; gap: 8px; align-items: center; }
    .actions { display: flex; justify-content: flex-end; }
    .progress { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px;
      li { border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; display: grid; gap: 4px; background: var(--surface); }
      li.err { border-color: var(--danger, #c0392b); } }
    .line { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; }
    .error-text { color: var(--danger, #c0392b); }
    .spinner.inline { display: inline-block; width: 12px; height: 12px; vertical-align: -2px; }
    @media (max-width: 600px) { .gen-row { grid-template-columns: 1fr auto; } .gen-row textarea { grid-column: 1 / -1; grid-row: 2; } }
  `,
})
export class PostGenerator {
  private api = inject(Api);

  readonly accountId = input.required<string>();
  /** Terminou de gerar (a lista de rascunhos deve recarregar). */
  readonly finished = output<void>();
  readonly open = output<number>();
  readonly closed = output<void>();

  protected readonly kinds = Object.keys(GEN_KIND_LABELS) as GenKind[];
  protected readonly kindLabels = GEN_KIND_LABELS;
  protected status = signal<GenStatus | null>(null);
  protected rows = signal<Row[]>([{ key: 0, kind: 'image', theme: '' }]);
  protected rewrite = signal(true);
  protected media = signal(true);
  protected busy = signal(false);
  protected error = signal('');
  protected job = signal<GenJob | null>(null);
  protected max = computed(() => this.status()?.maxItems ?? 10);
  protected ready = computed(() => this.rows().filter((r) => r.theme.trim()).length);

  private nextKey = 1;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.api
      .generateStatus()
      .then((s) => {
        this.status.set(s);
        this.rewrite.set(s.jev);
        this.media.set(s.stock);
      })
      .catch(() => undefined);
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
  }

  add(): void {
    if (this.rows().length >= this.max()) return;
    this.rows.update((rows) => [...rows, { key: this.nextKey++, kind: rows.at(-1)?.kind ?? 'image', theme: '' }]);
  }

  remove(i: number): void {
    this.rows.update((rows) => rows.filter((_, n) => n !== i));
  }

  update(i: number, change: Partial<Row>): void {
    this.rows.update((rows) => rows.map((r, n) => (n === i ? { ...r, ...change } : r)));
  }

  active = (item: GenItem) => !['fila', 'pronto', 'erro'].includes(item.step);
  stepLabel = (item: GenItem) =>
    item.step === 'midia' && item.kind === 'reel' ? 'Buscando vídeos…' : STEP_LABELS[item.step];

  async start(): Promise<void> {
    const items = this.rows()
      .filter((r) => r.theme.trim())
      .map((r) => ({ theme: r.theme.trim(), kind: r.kind }));
    if (!items.length) return;
    this.busy.set(true);
    this.error.set('');
    try {
      this.job.set(await this.api.generate(this.accountId(), { items, rewrite: this.rewrite(), media: this.media() }));
      this.poll();
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  private poll(): void {
    this.timer = setTimeout(async () => {
      const current = this.job();
      if (!current) return;
      try {
        const job = await this.api.generateJob(current.id);
        this.job.set(job);
        if (job.done) return this.finished.emit();
      } catch (e) {
        this.error.set(errorMessage(e));
        return;
      }
      this.poll();
    }, 2000);
  }

  reset(): void {
    this.job.set(null);
    this.rows.set([{ key: this.nextKey++, kind: 'image', theme: '' }]);
  }
}
