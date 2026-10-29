import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { Api, Artifact, Draft, DraftKind, DraftStatus, StockItem, errorMessage } from '../../core/api';
import { dateTimeBR } from '../../core/format';
import { ClaudePanel, ClaudeUse, applyClaudeText } from '../../shared/claude-panel';
import { JevReview } from '../../shared/jev-review';
import { PostGenerator } from './post-generator';

const KIND_LABELS: Record<DraftKind, string> = { image: 'Post estático', carousel: 'Carrossel', reel: 'Reels', story: 'Story' };
const STATUS: { value: DraftStatus; label: string }[] = [
  { value: 'ideia', label: 'Ideias' },
  { value: 'produzindo', label: 'Produzindo' },
  { value: 'pronto', label: 'Pronto para postar' },
  { value: 'publicado', label: 'Publicado' },
];

const ARTIFACTS_BY_KIND: Record<DraftKind, Artifact[]> = {
  image: ['legenda', 'card', 'ganchos', 'hashtags', 'melhorar', 'livre'],
  carousel: ['carrossel', 'legenda', 'ganchos', 'hashtags', 'melhorar', 'livre'],
  reel: ['roteiro', 'ganchos', 'som', 'legenda', 'hashtags', 'livre'],
  story: ['livre', 'ganchos', 'melhorar'],
};

const PROVIDERS: Record<StockItem['provider'], { label: string; site: string }> = {
  unsplash: { label: 'Unsplash', site: 'https://unsplash.com/?utm_source=gestao_instagram&utm_medium=referral' },
  pixabay: { label: 'Pixabay', site: 'https://pixabay.com' },
  pexels: { label: 'Pexels', site: 'https://www.pexels.com' },
};

@Component({
  selector: 'app-drafts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ClaudePanel, JevReview, PostGenerator],
  template: `
    <div class="layout">
      <section class="card list">
        <div class="list-head">
          <h2>Rascunhos</h2>
          <button type="button" class="btn primary" (click)="openGenerator()" title="Gerar de 1 a 10 posts com Claude + Jev">＋ Gerar posts</button>
        </div>
        <p class="muted small">Cada artefato (roteiro, legenda, textos do carrossel, ideia de som) fica guardado aqui até virar post.</p>
        <form class="new" (submit)="create($event)">
          <input type="text" placeholder="Novo rascunho: título ou ideia" [value]="newTitle()"
                 (input)="newTitle.set($any($event.target).value)" />
          <select [value]="newKind()" (change)="newKind.set($any($event.target).value)">
            @for (k of kinds; track k) { <option [value]="k">{{ kindLabels[k] }}</option> }
          </select>
          <button title="Cria um rascunho vazio com este título" class="btn primary" type="submit" [disabled]="!newTitle().trim()">Criar</button>
        </form>
        <button title="Pede ao Claude 10 ideias; cada uma vira um rascunho" type="button" class="link-btn" (click)="ideas.set(!ideas())">
          {{ ideas() ? 'Fechar' : 'Sem ideias? Peça 10 ao Claude' }}
        </button>
        @if (ideas()) {
          <app-claude-panel [accountId]="id()" [artifacts]="['ideias', 'livre']" (use)="createFromIdeas($event.text)" />
        }

        @for (s of statuses; track s.value) {
          <h3>{{ s.label }} <span class="muted">({{ byStatus()[s.value].length }})</span></h3>
          @for (d of byStatus()[s.value]; track d.id) {
            <button type="button" class="draft-item" [class.active]="selected()?.id === d.id" (click)="select(d)">
              <span>{{ d.title }}</span>
              <small class="muted">{{ kindLabels[d.kind] }} · {{ when(d.updated_at) }}@if (d.jev_grade !== null) { · Jev {{ d.jev_grade }} }@if (d.media.length) { · {{ selectedMedia(d).length }} mídia(s) }</small>
            </button>
          } @empty {
            <p class="muted small">—</p>
          }
        }
      </section>

      <section class="card editor">
        @if (generator()) {
          <app-post-generator [accountId]="id()" (finished)="load(id())" (open)="openGenerated($event)" (closed)="generator.set(false)" />
        } @else if (selected(); as d) {
          <div class="row">
            <input class="title" type="text" [value]="d.title" (change)="patch({ title: $any($event.target).value })" />
            <button title="Apaga este rascunho" type="button" class="btn ghost danger" (click)="remove(d)">Excluir</button>
          </div>
          <div class="row">
            <label class="field"><span>Formato</span>
              <select [value]="d.kind" (change)="patch({ kind: $any($event.target).value })">
                @for (k of kinds; track k) { <option [value]="k">{{ kindLabels[k] }}</option> }
              </select>
            </label>
            <label class="field"><span>Status</span>
              <select [value]="d.status" (change)="patch({ status: $any($event.target).value })">
                @for (s of statuses; track s.value) { <option [value]="s.value">{{ s.label }}</option> }
              </select>
            </label>
            <label class="field"><span>Gancho</span>
              <input type="text" list="hooks" [value]="d.hook ?? ''" (change)="patch({ hook: $any($event.target).value })" />
            </label>
            <label class="field"><span>Estilo</span>
              <input type="text" list="styles" [value]="d.style ?? ''" (change)="patch({ style: $any($event.target).value })" />
            </label>
          </div>
          <datalist id="hooks">@for (h of hooks; track h) { <option [value]="h"></option> }</datalist>
          <datalist id="styles">@for (s of styles; track s) { <option [value]="s"></option> }</datalist>

          <label class="field">
            <span>Texto do artefato (roteiro, legenda, textos dos slides…)</span>
            <textarea rows="12" [value]="body()" (input)="body.set($any($event.target).value)" (blur)="saveBody()"></textarea>
          </label>
          @if (d.media.length) {
            <div class="media-pick">
              <h4>Fotos e vídeos sugeridos
                <small class="muted">{{ d.kind === 'carousel' ? 'clique para marcar quais vão no carrossel' : 'clique para escolher' }}
                  · {{ selectedMedia(d).length }} escolhida(s)</small>
              </h4>
              <div class="thumbs">
                @for (m of d.media; track m.id) {
                  <button type="button" class="thumb" [class.on]="m.selected" (click)="toggleMedia(d, m)"
                          [title]="(m.selected ? 'Escolhida. Clique para tirar. ' : 'Clique para escolher. ') + m.description + ' — ' + m.credit" [attr.aria-pressed]="!!m.selected">
                    <img [src]="m.thumb" [alt]="m.description" loading="lazy" />
                    @if (m.kind === 'video') { <span class="tag">▶ {{ m.duration }}s{{ m.vertical ? '' : ' · horizontal' }}</span> }
                    @if (m.relevance !== undefined) { <span class="tag right" title="Quanto o Jev acha que combina com o tema">{{ pct(m.relevance) }}</span> }
                  </button>
                }
              </div>
              <small class="muted">Fotos e vídeos gratuitos de
                @for (p of providersOf(d); track p.label) { <a [href]="p.site" target="_blank" rel="noopener">{{ p.label }}</a>@if (!$last) {, } }.
                Escolhidos: @for (m of selectedMedia(d); track m.id) {
                  <a [href]="m.pageUrl" target="_blank" rel="noopener">{{ m.credit }}</a>@if (!$last) {, }
                } @empty { nenhum }.
                Ao levar para publicação, eles entram no post automaticamente.</small>
            </div>
          }
          <label class="field">
            <span>Anotações (referências, mídias a gravar, música, ideias)</span>
            <textarea rows="3" [value]="d.notes" (change)="patch({ notes: $any($event.target).value })"></textarea>
          </label>
          <div class="row end">
            <small class="muted">{{ saved() }}</small>
            <button type="button" class="btn primary" (click)="toPublish(d)" [disabled]="d.kind === 'story'"
                    [title]="d.kind === 'story' ? 'Stories ainda não são publicados pelo dashboard' : 'Abre o editor de publicação com o texto e as mídias escolhidas (você confere antes de publicar)'">
              Levar para publicação
            </button>
          </div>

          <app-claude-panel [accountId]="id()" [draftId]="d.id" [currentText]="body()"
                            [artifacts]="artifactsFor(d.kind)" (use)="useClaude($event)" />
          <app-jev-review [accountId]="id()" [caption]="body()" [kind]="d.kind" [offerTags]="true"
                          (tags)="patch({ hook: $event.hook ?? d.hook, style: $event.style ?? d.style })" />
        } @else {
          <div class="empty">
            <p><strong>Escolha um rascunho</strong> ou crie um novo.</p>
            <p class="muted">Dica: crie um rascunho por ideia, peça o roteiro ou a legenda ao Claude, ajuste com a sua voz e
              mova para “Pronto para postar”. Na hora de postar, clique em “Levar para publicação”.</p>
          </div>
        }
        @if (error()) { <p class="alert error">{{ error() }}</p> }
      </section>
    </div>
  `,
  styles: `
    .layout { display: grid; grid-template-columns: minmax(240px, 320px) 1fr; gap: 16px; align-items: start; }
    .list, .editor { display: grid; gap: 10px; }
    h2 { margin: 0; font-size: 1.1rem; }
    h3 { margin: 10px 0 0; font-size: .9rem; }
    .small { font-size: .82rem; margin: 0; }
    .new { display: grid; grid-template-columns: 1fr auto; gap: 6px; }
    .new input { grid-column: 1 / -1; }
    .draft-item { display: grid; text-align: left; gap: 2px; border: 1px solid var(--border); background: var(--surface);
      border-radius: 8px; padding: 8px 10px; cursor: pointer; font: inherit; color: inherit;
      &.active { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); } }
    .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: end; }
    .row .field { flex: 1; min-width: 130px; }
    .row.end { justify-content: flex-end; align-items: center; }
    .title { font-size: 1.1rem; font-weight: 600; flex: 1; }
    .empty { padding: 24px 8px; }
    .list-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    .media-pick { display: grid; gap: 6px;
      h4 { margin: 0; font-size: .92rem; } }
    .thumbs { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; }
    .thumb { position: relative; flex: none; width: 96px; height: 120px; padding: 0; border: 2px solid transparent;
      border-radius: 8px; overflow: hidden; cursor: pointer; background: var(--surface-2); opacity: .55;
      img { width: 100%; height: 100%; object-fit: cover; display: block; }
      &.on { border-color: var(--accent); opacity: 1; } }
    .tag { position: absolute; left: 4px; bottom: 4px; font-size: .7rem; background: rgb(0 0 0 / .65); color: #fff;
      border-radius: 4px; padding: 1px 4px;
      &.right { left: auto; right: 4px; } }
    @media (max-width: 800px) { .layout { grid-template-columns: 1fr; } }
  `,
})
export class DraftsPage {
  private api = inject(Api);
  private router = inject(Router);

  readonly id = input.required<string>();
  /** ?abrir=ID: abre este rascunho ao carregar. */
  readonly abrir = input<string>();

  protected readonly kinds = Object.keys(KIND_LABELS) as DraftKind[];
  protected readonly kindLabels = KIND_LABELS;
  protected readonly statuses = STATUS;
  protected readonly hooks = ['Pergunta', 'Número/lista', 'Erro comum', 'Antes e depois', 'Bastidor', 'Polêmica/contraste', 'Promessa', 'História pessoal'];
  protected readonly styles = ['Educativo', 'Inspiracional', 'Bastidores', 'Prova social', 'Oferta/venda', 'Humor', 'Tutorial'];

  protected drafts = signal<Draft[]>([]);
  protected selected = signal<Draft | null>(null);
  protected body = signal('');
  protected newTitle = signal('');
  protected newKind = signal<DraftKind>('reel');
  protected ideas = signal(false);
  protected generator = signal(false);
  protected error = signal('');
  protected saved = signal('');

  protected byStatus = computed(() => {
    const groups = Object.fromEntries(STATUS.map((s) => [s.value, [] as Draft[]])) as Record<DraftStatus, Draft[]>;
    for (const d of this.drafts()) groups[d.status]?.push(d);
    return groups;
  });

  protected when = dateTimeBR;
  protected artifactsFor = (kind: DraftKind) => ARTIFACTS_BY_KIND[kind];

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => {
        this.selected.set(null);
        this.load(id);
      });
    });
  }

  protected selectedMedia = (d: Draft) => d.media.filter((m) => m.selected);
  protected pct = (v: number) => `${Math.round(v * 100)}%`;
  protected providersOf = (d: Draft) =>
    [...new Set(d.media.map((m) => m.provider))].map((p) => ({ label: PROVIDERS[p].label, site: PROVIDERS[p].site }));

  openGenerator(): void {
    this.generator.set(true);
    this.selected.set(null);
  }

  async openGenerated(draftId: number): Promise<void> {
    await this.load(this.id());
    const d = this.drafts().find((x) => x.id === draftId);
    this.generator.set(false);
    if (d) this.select(d);
  }

  /** Carrossel: várias (até 10); post e Reels: só uma. */
  async toggleMedia(d: Draft, m: StockItem): Promise<void> {
    const current = this.selectedMedia(d).map((x) => x.id);
    const next =
      d.kind === 'carousel'
        ? m.selected
          ? current.filter((id) => id !== m.id)
          : [...current, m.id].slice(0, 10)
        : m.selected
          ? []
          : [m.id];
    try {
      const media = await this.api.setDraftMedia(d.id, next);
      const updated = { ...d, media };
      this.drafts.update((list) => list.map((x) => (x.id === d.id ? updated : x)));
      this.selected.set(updated);
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  async load(id: string): Promise<void> {
    try {
      this.drafts.set(await this.api.drafts(id));
      const open = this.drafts().find((d) => String(d.id) === this.abrir());
      if (open && !this.selected()) this.select(open);
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  select(d: Draft): void {
    this.generator.set(false);
    this.selected.set(d);
    this.body.set(d.body);
    this.saved.set('');
  }

  async create(event: Event): Promise<void> {
    event.preventDefault();
    const d = await this.api.createDraft(this.id(), { title: this.newTitle().trim(), kind: this.newKind() });
    this.newTitle.set('');
    this.drafts.update((list) => [d, ...list]);
    this.select(d);
  }

  /** Cada linha numerada/com hífen da resposta do Claude vira um rascunho em "Ideias". */
  async createFromIdeas(text: string): Promise<void> {
    const lines = text
      .split('\n')
      .map((l) => l.replace(/^\s*(\d+[.)]|-|•)\s*/, '').trim())
      .filter((l) => l.length > 8)
      .slice(0, 10);
    for (const line of lines) {
      const kind: DraftKind = /reels?/i.test(line) ? 'reel' : /carrossel/i.test(line) ? 'carousel' : 'image';
      await this.api.createDraft(this.id(), { title: line.slice(0, 120), kind, body: line });
    }
    this.ideas.set(false);
    await this.load(this.id());
  }

  async patch(changes: Partial<Draft>): Promise<void> {
    const d = this.selected();
    if (!d) return;
    try {
      const updated = await this.api.updateDraft(d.id, changes);
      this.drafts.update((list) => list.map((x) => (x.id === d.id ? updated : x)));
      this.selected.set(updated);
      this.saved.set('Salvo');
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  async saveBody(): Promise<void> {
    if (this.selected() && this.body() !== this.selected()!.body) await this.patch({ body: this.body() });
  }

  useClaude(use: ClaudeUse): void {
    this.body.update((b) => applyClaudeText(b, use));
    this.saveBody();
  }

  async remove(d: Draft): Promise<void> {
    if (!confirm(`Excluir o rascunho “${d.title}”?`)) return;
    await this.api.deleteDraft(d.id);
    this.drafts.update((list) => list.filter((x) => x.id !== d.id));
    this.selected.set(null);
  }

  async toPublish(d: Draft): Promise<void> {
    await this.saveBody();
    if (d.status !== 'pronto') await this.patch({ status: 'pronto' });
    this.router.navigate(['/conta', this.id(), 'publicar'], { queryParams: { rascunho: d.id } });
  }
}
