import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { AccountsStore } from '../../core/accounts';
import { Api, Experiments, Format, Post, errorMessage } from '../../core/api';
import { dateBR, dec, downloadBlob, num, pct, todayIso } from '../../core/format';

type SortKey = keyof Pick<Post, 'timestamp' | 'reach' | 'views' | 'likes' | 'comments' | 'saved' | 'shares' | 'profileVisits' | 'follows' | 'avgWatchSec' | 'engagementRate' | 'score'>;

const COLUMNS: { key: SortKey; label: string; title?: string }[] = [
  { key: 'reach', label: 'Alcance' },
  { key: 'views', label: 'Visualiz.' },
  { key: 'likes', label: 'Curtidas' },
  { key: 'comments', label: 'Coment.' },
  { key: 'saved', label: 'Salv.' },
  { key: 'shares', label: 'Compart.' },
  { key: 'profileVisits', label: 'Visitas', title: 'Visitas ao perfil (posts e carrosséis)' },
  { key: 'follows', label: 'Seguiu', title: 'Novos seguidores a partir do post' },
  { key: 'avgWatchSec', label: 'Assistido', title: 'Tempo médio assistido (Reels), em segundos' },
  { key: 'engagementRate', label: 'Engaj.', title: 'Interações ÷ alcance' },
  { key: 'score', label: 'Score', title: 'Sinais ponderados por 100 contas alcançadas' },
];

const SIGNAL_LABELS: Record<string, string> = {
  shares: 'Compartilhamentos',
  saved: 'Salvamentos',
  comments: 'Comentários',
  likes: 'Curtidas',
  profile_visits: 'Visitas ao perfil',
};

@Component({
  selector: 'app-posts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card">
      <div class="filters">
        <label class="field"><span>De</span><input type="date" [value]="from()" (change)="from.set($any($event.target).value)" /></label>
        <label class="field"><span>Até</span><input type="date" [value]="to()" (change)="to.set($any($event.target).value)" /></label>
        <label class="field"><span>Formato</span>
          <select [value]="format()" (change)="format.set($any($event.target).value)">
            <option value="">Todos</option>
            <option value="reels">Reels</option>
            <option value="carrossel">Carrossel</option>
            <option value="post">Post estático</option>
            <option value="video">Vídeo</option>
          </select>
        </label>
        <span class="spacer"></span>
        <button type="button" class="btn ghost" (click)="exportCsv()">Exportar CSV</button>
      </div>

      @if (error()) { <p class="alert error">{{ error() }}</p> }

      <div class="table-scroll">
        <table class="data posts">
          <thead>
            <tr>
              <th><button type="button" class="sort" (click)="sortBy('timestamp')">Post {{ arrow('timestamp') }}</button></th>
              @for (c of columns; track c.key) {
                <th class="num"><button type="button" class="sort" [title]="c.title ?? ''" (click)="sortBy(c.key)">{{ c.label }} {{ arrow(c.key) }}</button></th>
              }
              <th>Experimento</th>
            </tr>
          </thead>
          <tbody>
            @for (p of sorted(); track p.id) {
              <tr class="row" tabindex="0" [class.open]="open() === p.id" (click)="toggle(p)" (keydown.enter)="toggle(p)">
                <td class="post-cell">
                  @if (p.thumbnail) { <img [src]="p.thumbnail" alt="" loading="lazy" /> }
                  <span><strong>{{ p.formatLabel }}</strong><small class="muted">{{ fmt.dateBR(p.timestamp) }}</small></span>
                </td>
                @for (c of columns; track c.key) {
                  <td class="num">{{ cell(p, c.key) }}</td>
                }
                <td><small>{{ tagsOf(p) }}@if (p.taggedBy === 'jev') { <span class="jev-mark" title="Sugerido pelo Jev: abra o post e salve para confirmar"> ◆</span> }</small></td>
              </tr>
              @if (open() === p.id) {
                <tr class="detail">
                  <td [attr.colspan]="columns.length + 2">
                    <div class="detail-grid">
                      <div>
                        <p class="caption">{{ p.caption || '(sem legenda)' }}</p>
                        <a [href]="p.permalink" target="_blank" rel="noopener">Abrir no Instagram ↗</a>
                        <h4>De onde vem o score ({{ fmt.dec(p.score) }})</h4>
                        @for (part of parts(p); track part.key) {
                          <div class="bar-row">
                            <span>{{ part.label }}</span>
                            <span class="bar"><span [style.width.%]="part.pct"></span></span>
                            <span class="num">{{ fmt.dec(part.value) }}</span>
                          </div>
                        }
                      </div>
                      <form class="tags" (submit)="saveTags($event, p)">
                        <h4>Registro do experimento</h4>
                        @if (p.taggedBy === 'jev') {
                          <p class="muted small">◆ Gancho e estilo sugeridos pelo Jev. Corrija se precisar e salve para confirmar.</p>
                        }
                        <label class="field"><span>Gancho</span><input name="hook" list="hook-options" [value]="p.hook ?? ''" /></label>
                        <label class="field"><span>Estilo</span><input name="style" list="style-options" [value]="p.style ?? ''" /></label>
                        <label class="field"><span>Pilar de conteúdo</span><input name="pillar" list="pillar-options" [value]="p.pillar ?? ''" placeholder="Ex.: bastidores, produto, dica" /></label>
                        <label class="field"><span>Anotações</span><textarea name="notes" rows="3" [value]="p.notes"></textarea></label>
                        <button class="btn primary" type="submit">Salvar</button>
                      </form>
                    </div>
                  </td>
                </tr>
              }
            } @empty {
              <tr><td [attr.colspan]="columns.length + 2" class="muted">{{ loading() ? 'Carregando…' : 'Nenhum post neste filtro. Sincronize a conta para trazer os posts.' }}</td></tr>
            }
          </tbody>
        </table>
      </div>
      <datalist id="hook-options">@for (h of experiments()?.options?.hooks ?? []; track h) { <option [value]="h"></option> }</datalist>
      <datalist id="style-options">@for (s of experiments()?.options?.styles ?? []; track s) { <option [value]="s"></option> }</datalist>
      <datalist id="pillar-options">@for (s of experiments()?.options?.pillars ?? []; track s) { <option [value]="s"></option> }</datalist>
    </section>

    <section class="card">
      <div class="exp-head">
        <h2>Experimentos: o que funciona melhor</h2>
        @if (jevOn() && jevPending() > 0) {
          <button type="button" class="btn ghost" [disabled]="tagging()" (click)="autotag()"
                  title="O Jev lê a legenda e sugere gancho e estilo; só grava quando tem confiança alta">
            @if (tagging()) { <span class="spinner"></span> Classificando… } @else { ◆ Classificar {{ jevPending() }} post(s) com o Jev }
          </button>
        }
      </div>
      @if (tagMessage()) { <p class="alert info">{{ tagMessage() }}</p> }
      @if (experiments(); as e) {
        @if (!e.tagged) {
          <p class="muted">Clique em um post acima e registre o <strong>gancho</strong> e o <strong>estilo</strong> usados.
            Com alguns posts registrados, este quadro mostra qual combinação gera mais resposta.</p>
        } @else {
          <p class="muted small">{{ e.tagged }} post(s) com experimento registrado. Ordenado por score médio.</p>
          <div class="table-scroll">
            <table class="data">
              <thead><tr><th>Formato</th><th>Gancho</th><th>Estilo</th><th class="num">Posts</th><th class="num">Score médio</th><th class="num">Alcance médio</th><th class="num">Compart.</th><th class="num">Salv.</th></tr></thead>
              <tbody>
                @for (c of e.combos; track $index; let i = $index) {
                  <tr [class.best]="i === 0 && c.posts > 0">
                    <td>{{ c.format }}</td><td>{{ c.hook }}</td><td>{{ c.style }}</td><td class="num">{{ c.posts }}</td>
                    <td class="num">{{ fmt.dec(c.avgScore) }}</td><td class="num">{{ fmt.num(c.avgReach) }}</td>
                    <td class="num">{{ fmt.dec(c.avgShares) }}</td><td class="num">{{ fmt.dec(c.avgSaves) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <div class="grid-3">
            @for (g of [{ t: 'Por gancho', rows: e.byHook }, { t: 'Por estilo', rows: e.byStyle }, { t: 'Por pilar', rows: e.byPillar }]; track g.t) {
              <div>
                <h4>{{ g.t }}</h4>
                <table class="data">
                  <tbody>
                    @for (r of g.rows; track r.value) {
                      <tr><td>{{ r.value }}</td><td class="num">{{ r.posts }} post(s)</td><td class="num">score {{ fmt.dec(r.avgScore) }}</td></tr>
                    } @empty { <tr><td class="muted">—</td></tr> }
                  </tbody>
                </table>
              </div>
            }
          </div>
          <p class="muted small">Amostras pequenas enganam: só confie numa combinação depois de 3+ posts.</p>
        }
      }
    </section>
  `,
  styles: `
    :host { display: grid; gap: 16px; }
    h2 { margin: 0 0 8px; font-size: 1.05rem; }
    h4 { margin: 12px 0 6px; font-size: .9rem; }
    .small { font-size: .82rem; }
    .filters { display: flex; gap: 12px; align-items: end; flex-wrap: wrap; margin-bottom: 12px; }
    .filters .field { width: 160px; }
    .spacer { flex: 1; }
    .sort { border: 0; background: none; font: inherit; font-weight: 600; color: inherit; cursor: pointer; padding: 0; white-space: nowrap; }
    .posts .row { cursor: pointer; }
    .posts .row:hover, .posts .row.open { background: var(--surface-2); }
    .post-cell { display: flex; gap: 8px; align-items: center; min-width: 140px;
      img { width: 36px; height: 45px; object-fit: cover; border-radius: 4px; }
      span { display: grid; } }
    .detail td { background: var(--surface-2); }
    .detail-grid { display: grid; grid-template-columns: 1.4fr 1fr; gap: 24px; padding: 8px; }
    .caption { white-space: pre-wrap; margin: 0 0 8px; max-height: 200px; overflow: auto; }
    .bar-row { display: grid; grid-template-columns: 130px 1fr 50px; gap: 8px; align-items: center; font-size: .85rem; }
    .bar { height: 8px; background: var(--border); border-radius: 4px; overflow: hidden;
      span { display: block; height: 100%; background: var(--series-1); border-radius: 4px; } }
    .tags { display: grid; gap: 8px; align-content: start; }
    .best td { background: var(--ok-bg); }
    .exp-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px;
      h2 { margin: 0; } }
    .jev-mark { color: var(--series-1); }
    @media (max-width: 800px) { .detail-grid { grid-template-columns: 1fr; } }
  `,
})
export class PostsPage {
  private api = inject(Api);
  private store = inject(AccountsStore);

  readonly id = input.required<string>();

  protected readonly columns = COLUMNS;
  protected readonly fmt = { dateBR, dec, num, pct };

  protected from = signal(todayIso(-90));
  protected to = signal(todayIso());
  protected format = signal<Format | ''>('');
  protected posts = signal<Post[]>([]);
  protected experiments = signal<Experiments | null>(null);
  protected sortKey = signal<SortKey>('timestamp');
  protected sortDir = signal<1 | -1>(-1);
  protected open = signal<string | null>(null);
  protected loading = signal(false);
  protected error = signal('');
  protected jevOn = signal(false);
  protected jevPending = signal(0);
  protected tagging = signal(false);
  protected tagMessage = signal('');

  protected sorted = computed(() => {
    const key = this.sortKey();
    const dir = this.sortDir();
    return [...this.posts()].sort((a, b) => {
      const va = a[key] ?? -Infinity;
      const vb = b[key] ?? -Infinity;
      return (va < vb ? -1 : va > vb ? 1 : 0) * dir;
    });
  });

  constructor() {
    effect(() => {
      const id = this.id();
      const filter = { from: this.from(), to: this.to(), format: this.format() || undefined };
      this.store.dataVersion();
      untracked(() => this.load(id, filter));
    });
  }

  private async load(id: string, filter: { from: string; to: string; format?: string }): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const [posts, experiments] = await Promise.all([this.api.posts(id, filter), this.api.experiments(id)]);
      this.posts.set(posts);
      this.experiments.set(experiments);
      this.loadJev(id);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  private async loadJev(id: string): Promise<void> {
    try {
      const status = await this.api.jevStatus();
      this.jevOn.set(status.configured);
      if (status.configured) this.jevPending.set((await this.api.autotagPending(id)).pending);
    } catch {
      this.jevOn.set(false);
    }
  }

  async autotag(): Promise<void> {
    this.tagging.set(true);
    this.tagMessage.set('');
    this.error.set('');
    try {
      const r = await this.api.autotag(this.id());
      const parts = [`${r.tagged} post(s) classificado(s) pelo Jev (marcados com ◆).`];
      if (r.uncertain) parts.push(`${r.uncertain} ficaram sem sugestão porque o Jev estava em dúvida: registre à mão.`);
      if (r.failed) parts.push(`${r.failed} falharam; tente de novo.`);
      if (r.remaining) parts.push(`Faltam ${r.remaining}: clique de novo para continuar.`);
      this.tagMessage.set(parts.join(' '));
      this.jevPending.set(r.remaining);
      this.store.dataVersion.update((v) => v + 1);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.tagging.set(false);
    }
  }

  sortBy(key: SortKey): void {
    if (this.sortKey() === key) this.sortDir.update((d) => (d === 1 ? -1 : 1));
    else {
      this.sortKey.set(key);
      this.sortDir.set(-1);
    }
  }

  arrow(key: SortKey): string {
    return this.sortKey() === key ? (this.sortDir() === 1 ? '▲' : '▼') : '';
  }

  cell(p: Post, key: SortKey): string {
    const v = p[key];
    if (key === 'engagementRate') return pct(v as number | null);
    if (key === 'score' || key === 'avgWatchSec') return dec(v as number | null);
    return num(v as number | null);
  }

  tagsOf(p: Post): string {
    return [p.hook, p.style, p.pillar].filter((t) => !!t).join(' · ') || '—';
  }

  parts(p: Post) {
    const total = Object.values(p.scoreParts).reduce((a, b) => a + b, 0) || 1;
    return Object.entries(p.scoreParts)
      .map(([key, value]) => ({ key, label: SIGNAL_LABELS[key] ?? key, value, pct: (value / total) * 100 }))
      .sort((a, b) => b.value - a.value);
  }

  toggle(p: Post): void {
    this.open.update((id) => (id === p.id ? null : p.id));
  }

  async saveTags(event: Event, p: Post): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.target as HTMLFormElement);
    const val = (k: string) => (String(form.get(k) ?? '').trim() || null);
    const tags = { hook: val('hook'), style: val('style'), pillar: val('pillar'), notes: String(form.get('notes') ?? '') };
    try {
      await this.api.saveTags(p.id, tags);
      this.posts.update((list) => list.map((x) => (x.id === p.id ? { ...x, ...tags, taggedBy: null } : x)));
      this.experiments.set(await this.api.experiments(this.id()));
      this.open.set(null);
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  async exportCsv(): Promise<void> {
    const blob = await this.api.postsCsv(this.id(), { from: this.from(), to: this.to(), format: this.format() || undefined });
    downloadBlob(blob, `posts-${this.id()}-${this.from()}-a-${this.to()}.csv`);
  }
}
