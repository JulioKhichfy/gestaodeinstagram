import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api, GenJob, GenKind, HubOptionView, MovieCatalog, MovieRow, errorMessage } from '../../core/api';
import { GEN_KIND_LABELS, STEP_LABELS } from './post-generator';

interface Row extends MovieRow {
  key: number;
}

const FORMATS: GenKind[] = ['image', 'carousel', 'reel', 'story'];

/**
 * Central de Filmes: cada linha = menu › opção (como os menus do IMDb, só como roteiro), formato e quantidade.
 * O Claude escolhe os títulos (manchetes atuais ou conhecimento próprio) e escreve sem spoilers; o Jev revisa.
 * Só texto: nenhuma imagem é baixada.
 */
@Component({
  selector: 'app-movies',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <section class="card">
      <h2>Central de Filmes</h2>
      <p class="muted small">Para cada linha, escolha o menu, a opção, o formato e a quantidade. O Claude escolhe os títulos
        (📰 = usa manchetes atuais; as demais usam o conhecimento dele) e escreve <strong>sem spoilers</strong>, dentro dos limites
        de caracteres; o Jev revisa. Nada é copiado do IMDb: os menus são só o roteiro.</p>

      @if (catalog(); as cat) {
        @if (!job()) {
          <div class="rows">
            @for (r of rows(); track r.key; let i = $index) {
              <div class="row">
                <input class="qty" type="number" min="0" max="10" [value]="r.qty" (input)="update(i, { qty: +$any($event.target).value })"
                       aria-label="Quantidade" title="Quantos posts desta linha (0 = ignorar)" />
                <select [value]="r.kind" (change)="update(i, { kind: $any($event.target).value })" aria-label="Formato" title="Formato dos posts desta linha">
                  @for (k of formats; track k) { <option [value]="k">{{ kindLabels[k] }}</option> }
                </select>
                <select [value]="r.group" (change)="setGroup(i, $any($event.target).value)" aria-label="Menu" title="Menu (como os do IMDb)">
                  @for (g of cat.groups; track g.id) { <option [value]="g.id">{{ g.label }}</option> }
                </select>
                <select [value]="r.option" (change)="update(i, { option: $any($event.target).value })" aria-label="Opção" title="Opção do menu: o tema dos posts">
                  @for (o of optionsOf(r.group); track o.id) { <option [value]="o.id">{{ o.current ? '📰 ' : '' }}{{ o.label }}</option> }
                </select>
                <input class="extra" type="text" [value]="r.extra ?? ''" (input)="update(i, { extra: $any($event.target).value })"
                       [placeholder]="extraLabel(r)" [attr.aria-label]="extraLabel(r)"
                       title="Opcional: gênero, ou títulos que você quer (separados por vírgula)" />
                <button type="button" class="btn ghost" (click)="remove(i)" [disabled]="rows().length === 1" title="Remover esta linha" aria-label="Remover linha">✕</button>
              </div>
            }
          </div>
          <div class="foot">
            <button type="button" class="btn ghost" (click)="add()" title="Mais uma combinação de menu, formato e quantidade">＋ Adicionar linha</button>
            <label class="check" title="Se a nota do Jev ficar abaixo de 75, o Claude reescreve seguindo as dicas dele (até 2 vezes)">
              <input type="checkbox" [checked]="rewrite()" (change)="rewrite.set($any($event.target).checked)" /> Reescrever até o Jev aprovar
            </label>
            <span class="spacer"></span>
            <span class="muted" [class.over]="total() > cat.maxPosts">{{ total() }} de no máximo {{ cat.maxPosts }} posts</span>
            <button type="button" class="btn primary" [disabled]="busy() || !total() || total() > cat.maxPosts" (click)="start()"
                    title="O Claude escolhe os títulos e escreve; o Jev revisa. Tudo vira rascunho para você conferir.">
              @if (busy()) { <span class="spinner"></span> Enviando… } @else { Gerar posts }
            </button>
          </div>
        } @else {
          @if (job(); as j) {
            @if (j.phase === 'planejando' && !j.done) {
              <p><span class="spinner inline"></span> O Claude está escolhendo os títulos de cada linha…</p>
            }
            @if (j.error) { <p class="alert error">{{ j.error }}</p> }
            <ul class="progress">
              @for (item of j.items; track $index) {
                <li [class.err]="item.step === 'erro'">
                  <span><strong>{{ item.title || item.theme }}</strong> <small class="muted">{{ kindLabels[item.kind] }}</small></span>
                  <span>
                    {{ steps[item.step] }}@if (item.grades.length) { · Jev {{ item.grades.join(' → ') }} }
                    @if (item.draftId) { · <a [routerLink]="['..', 'rascunhos']" [queryParams]="{ abrir: item.draftId }" title="Revisar o texto">abrir rascunho</a> }
                  </span>
                  @if (item.error) { <small class="error-text">{{ item.error }}</small> }
                  @for (n of item.notes; track n) { <small class="muted">{{ n }}</small> }
                </li>
              }
            </ul>
            @if (j.done) {
              <div class="foot"><span class="spacer"></span>
                <button type="button" class="btn ghost" (click)="reset()" title="Voltar para as linhas">Gerar outros</button></div>
            } @else if (j.phase === 'gerando') {
              <p class="muted small">Pode navegar pelo dashboard: a geração continua no backend (de 30 s a 2 min por post).</p>
            }
          }
        }
      }
      @if (error()) { <p class="alert error">{{ error() }}</p> }
    </section>
  `,
  styles: `
    h2 { margin: 0 0 4px; font-size: 1.1rem; }
    .small { font-size: .85rem; margin: 0 0 10px; }
    .rows { display: grid; gap: 8px; margin: 10px 0; }
    .row { display: grid; grid-template-columns: 70px 130px 170px minmax(200px, 1.4fr) minmax(160px, 1fr) auto; gap: 8px; align-items: center; }
    .qty { text-align: center; }
    .foot { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .spacer { flex: 1; }
    .check { display: flex; gap: 6px; align-items: center; }
    .over { color: var(--danger, #c0392b); font-weight: 600; }
    .progress { list-style: none; padding: 0; margin: 10px 0; display: grid; gap: 8px;
      li { display: grid; gap: 2px; border-bottom: 1px solid var(--border); padding-bottom: 8px; }
      li.err { border-color: var(--danger, #c0392b); } }
    .error-text { color: var(--danger, #c0392b); }
    .spinner.inline { display: inline-block; width: 12px; height: 12px; vertical-align: -2px; }
    @media (max-width: 900px) { .row { grid-template-columns: 60px 1fr 1fr; } .row .extra { grid-column: 1 / -2; } }
  `,
})
export class MoviesPage {
  private api = inject(Api);

  readonly id = input.required<string>();

  protected readonly formats = FORMATS;
  protected readonly kindLabels = GEN_KIND_LABELS;
  protected readonly steps = STEP_LABELS;

  protected catalog = signal<MovieCatalog | null>(null);
  protected rows = signal<Row[]>([]);
  protected rewrite = signal(true);
  protected busy = signal(false);
  protected error = signal('');
  protected job = signal<GenJob | null>(null);
  protected total = computed(() => this.rows().reduce((a, r) => a + (r.qty > 0 ? r.qty : 0), 0));

  private nextKey = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() =>
        this.api
          .movieCatalog(id)
          .then((cat) => {
            this.catalog.set(cat);
            // Uma linha por formato, para você só preencher as quantidades.
            const first = cat.groups[0];
            this.rows.set(FORMATS.map((kind) => ({ key: this.nextKey++, kind, qty: 0, group: first.id, option: first.options[0].id })));
          })
          .catch((e) => this.error.set(errorMessage(e))),
      );
    });
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
  }

  optionsOf = (groupId: string): HubOptionView[] => this.catalog()?.groups.find((g) => g.id === groupId)?.options ?? [];

  extraLabel = (r: Row) => this.optionsOf(r.group).find((o) => o.id === r.option)?.extra ?? 'Títulos que você quer (opcional)';

  update(i: number, change: Partial<Row>): void {
    this.rows.update((rows) => rows.map((r, n) => (n === i ? { ...r, ...change } : r)));
  }

  setGroup(i: number, group: string): void {
    this.update(i, { group, option: this.optionsOf(group)[0]?.id ?? '' });
  }

  add(): void {
    const first = this.catalog()!.groups[0];
    this.rows.update((rows) => [...rows, { key: this.nextKey++, kind: 'image', qty: 1, group: first.id, option: first.options[0].id }]);
  }

  remove(i: number): void {
    this.rows.update((rows) => rows.filter((_, n) => n !== i));
  }

  async start(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      const rows = this.rows()
        .filter((r) => r.qty > 0)
        .map(({ group, option, kind, qty, extra }) => ({ group, option, kind, qty, extra: extra?.trim() || undefined }));
      this.job.set(await this.api.generateMovies(this.id(), rows, this.rewrite()));
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
        if (!job.done) this.poll();
      } catch (e) {
        this.error.set(errorMessage(e));
      }
    }, 2000);
  }

  reset(): void {
    this.job.set(null);
  }
}
