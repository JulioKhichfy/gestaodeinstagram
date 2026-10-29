import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api, GenKind, RadarCluster, RadarView, Temperature, errorMessage } from '../../core/api';
import { GEN_KIND_LABELS } from './post-generator';

const TEMP_LABELS: Record<Temperature, string> = { quente: '🔥 Quente', morna: 'Morna', fria: 'Fria' };

/** Confirmado / rumor a partir da probabilidade do Jev. */
export function confirmation(p: number | null): { label: string; cls: string; help: string } | null {
  if (p === null) return null;
  if (p >= 0.6) return { label: 'Confirmado', cls: 'ok', help: 'As fontes tratam como fato (oficial ou já aconteceu)' };
  if (p <= 0.4) return { label: 'Rumor', cls: 'warn', help: 'Especulação ou "pode": o post vai dizer que não está confirmado' };
  return { label: 'Incerto', cls: '', help: 'O Jev ficou em dúvida se é fato ou rumor: confira antes de postar' };
}

export function ago(iso: string, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `há ${h} h` : `há ${Math.round(h / 24)} d`;
}

/**
 * Radar: notícias do tema das últimas 48 h, agrupadas por assunto. Quanto mais veículos falando em pouco tempo,
 * mais quente. Um clique cria o rascunho do post (com outras palavras e a fonte creditada).
 */
@Component({
  selector: 'app-radar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <section class="card">
      <div class="head">
        <div>
          <h2>Radar {{ view()?.topic }}</h2>
          <p class="muted small">
            Fontes: {{ view()?.feeds?.join(', ') }}. Lidas sozinhas a cada 10 min (com o dashboard aberto no PC).
            @if (view()?.lastRefresh; as t) { Última leitura: {{ agoMs(t) }}. }
          </p>
        </div>
        <button type="button" class="btn primary" [disabled]="refreshing()" (click)="refresh()" title="Lê as fontes agora e classifica as notícias novas">
          @if (refreshing()) { <span class="spinner"></span> Lendo… } @else { Atualizar agora }
        </button>
      </div>
      <div class="filters" role="group" aria-label="Filtro">
        @for (f of filters; track f.value) {
          <button type="button" [class.active]="filter() === f.value" [title]="f.help" (click)="filter.set(f.value)">{{ f.label }}</button>
        }
      </div>
      @if (!view()?.jev && view()) { <p class="muted small">Jev desligado: sem a classificação (tipo, confirmado ou rumor).</p> }
      @if (message()) { <p class="alert info">{{ message() }}</p> }
      @if (error()) { <p class="alert error">{{ error() }}</p> }
    </section>

    @for (c of shown(); track c.id) {
      <article class="card news" [class.hot]="c.temperature === 'quente'">
        <div class="badges">
          <span class="badge" [class.hot]="c.temperature === 'quente'" title="Quente: 3+ veículos nas últimas 6 h, ou última hora relevante">{{ temps[c.temperature] }}</span>
          <span class="badge" title="Quantos veículos publicaram este assunto">{{ c.sources }} fonte(s)</span>
          <span class="badge" [title]="'Primeira notícia: ' + ago(c.firstAt)">{{ ago(c.lastAt) }}</span>
          @if (c.kindLabel) { <span class="badge" title="Tipo, segundo o Jev">{{ c.kindLabel }}</span> }
          @if (conf(c.confirmed); as k) { <span [class]="'badge ' + k.cls" [title]="k.help">{{ k.label }}</span> }
          @if (isNew(c)) { <span class="badge new" title="Apareceu desde a sua última visita">Novo</span> }
        </div>
        <h3>{{ c.title }}</h3>
        @if (c.summary) { <p class="muted summary">{{ c.summary }}</p> }
        <details>
          <summary title="Links para as matérias originais">Ver as {{ c.items.length }} matéria(s)</summary>
          <ul class="items">
            @for (i of c.items; track i.link) {
              <li><a [href]="i.link" target="_blank" rel="noopener">{{ i.source }}</a>: {{ i.title }} <small class="muted">({{ ago(i.published) }})</small></li>
            }
          </ul>
        </details>
        <div class="actions">
          @if (c.draftId) {
            <a class="btn ghost" [routerLink]="['..', 'rascunhos']" [queryParams]="{ abrir: c.draftId }" title="Revisar o post gerado">Abrir rascunho</a>
          } @else if (jobs()[c.id]; as st) {
            <span class="muted"><span class="spinner inline"></span> {{ st }}</span>
          } @else {
            <select [value]="kindFor(c)" (change)="setKind(c, $any($event.target).value)" aria-label="Formato do post" title="Formato do post">
              @for (k of kinds; track k) { <option [value]="k">{{ kindLabels[k] }}</option> }
            </select>
            <button type="button" class="btn primary" [disabled]="!!busy()" (click)="createPost(c)"
                    title="O Claude escreve com outras palavras, cita a fonte e trata rumor como rumor; o Jev revisa. Vira rascunho.">Criar post</button>
          }
          <button type="button" class="btn ghost" (click)="ignore(c)" title="Tira da lista (não aparece de novo)">Ignorar</button>
        </div>
      </article>
    } @empty {
      <p class="muted card">{{ loading() ? 'Carregando…' : 'Nada por aqui. Clique em "Atualizar agora".' }}</p>
    }
  `,
  styles: `
    :host { display: grid; gap: 12px; }
    h2 { margin: 0 0 4px; font-size: 1.1rem; }
    h3 { margin: 6px 0; font-size: 1rem; }
    .small { font-size: .85rem; margin: 0; }
    .head { display: flex; justify-content: space-between; gap: 12px; align-items: start; flex-wrap: wrap; }
    .filters { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px;
      button { border: 1px solid var(--border); background: var(--surface); border-radius: 999px; padding: 5px 12px; cursor: pointer; font: inherit; color: inherit; }
      button.active { background: var(--accent); color: #fff; border-color: var(--accent); } }
    .news.hot { border-left: 4px solid var(--accent); }
    .badges { display: flex; gap: 6px; flex-wrap: wrap; }
    .badge { font-size: .75rem; border: 1px solid var(--border); border-radius: 999px; padding: 2px 8px;
      &.hot { background: var(--accent); color: #fff; border-color: var(--accent); }
      &.ok { background: var(--ok-bg); color: var(--ok-text); border-color: transparent; }
      &.warn { background: var(--warn-bg); color: var(--warn-text); border-color: transparent; }
      &.new { border-color: var(--accent); color: var(--accent); } }
    .summary { margin: 0 0 6px; font-size: .9rem; }
    .items { margin: 6px 0; padding-left: 18px; display: grid; gap: 4px; font-size: .88rem; }
    details summary { cursor: pointer; color: var(--muted); font-size: .85rem; }
    .actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 8px; }
    .spinner.inline { display: inline-block; width: 12px; height: 12px; vertical-align: -2px; }
  `,
})
export class RadarPage {
  private api = inject(Api);

  readonly id = input.required<string>();

  protected readonly temps = TEMP_LABELS;
  protected readonly kinds = Object.keys(GEN_KIND_LABELS) as GenKind[];
  protected readonly kindLabels = GEN_KIND_LABELS;
  protected readonly filters = [
    { value: 'todas', label: 'Todas', help: 'Tudo das últimas 48 h' },
    { value: 'quente', label: '🔥 Quentes', help: 'Muitos veículos falando agora' },
    { value: 'ultima_hora', label: 'Última hora', help: 'Fatos novos e importantes' },
    { value: 'mercado', label: 'Mercado', help: 'Contratações e vendas (muito rumor: cuidado)' },
    { value: 'jogo', label: 'Jogo', help: 'Prévias, escalações e repercussão' },
  ];
  protected readonly conf = confirmation;
  protected ago = (iso: string) => ago(iso);
  protected agoMs = (ms: number) => ago(new Date(ms).toISOString());

  protected view = signal<RadarView | null>(null);
  protected filter = signal('todas');
  protected loading = signal(false);
  protected refreshing = signal(false);
  protected busy = signal<string | null>(null);
  protected message = signal('');
  protected error = signal('');
  /** Geração em andamento por notícia (texto do passo atual). */
  protected jobs = signal<Record<string, string>>({});
  private kindChoice = signal<Record<string, GenKind>>({});
  private lastSeen = 0;

  protected shown = computed(() => {
    const f = this.filter();
    const list = this.view()?.clusters ?? [];
    if (f === 'todas') return list;
    if (f === 'quente') return list.filter((c) => c.temperature === 'quente');
    return list.filter((c) => c.kind === f);
  });

  constructor() {
    const key = () => `radar-visto-${this.id()}`;
    effect(() => {
      const id = this.id();
      untracked(() => {
        try {
          this.lastSeen = Number(localStorage.getItem(key()) ?? 0);
        } catch {
          this.lastSeen = 0;
        }
        this.load(id, true);
      });
    });
    // A lista se atualiza sozinha; o backend lê as fontes a cada 10 min.
    const timer = setInterval(() => this.load(this.id(), false), 60_000);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
      try {
        localStorage.setItem(key(), String(Date.now()));
      } catch {
        // sem armazenamento local: só não marca "Novo"
      }
    });
  }

  isNew = (c: RadarCluster) => this.lastSeen > 0 && Date.parse(c.firstAt) > this.lastSeen;
  kindFor = (c: RadarCluster): GenKind => this.kindChoice()[c.id] ?? (c.kind === 'historia' ? 'carousel' : 'image');
  setKind = (c: RadarCluster, k: GenKind) => this.kindChoice.update((m) => ({ ...m, [c.id]: k }));

  private async load(id: string, spinner: boolean): Promise<void> {
    if (spinner) this.loading.set(true);
    try {
      this.view.set(await this.api.radar(id));
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  async refresh(): Promise<void> {
    this.refreshing.set(true);
    this.error.set('');
    try {
      const r = await this.api.refreshRadar(this.id());
      const failed = r.feeds.filter((f) => !f.ok);
      this.message.set(
        `${r.read} manchete(s) lida(s), ${r.added} nova(s), ${r.classified} classificada(s) pelo Jev.` +
          (failed.length ? ` Fora do ar agora: ${failed.map((f) => f.name).join(', ')}.` : ''),
      );
      await this.load(this.id(), false);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.refreshing.set(false);
    }
  }

  async createPost(c: RadarCluster): Promise<void> {
    this.busy.set(c.id);
    this.error.set('');
    try {
      const job = await this.api.radarPost(this.id(), c.id, this.kindFor(c));
      this.jobs.update((m) => ({ ...m, [c.id]: 'Na fila…' }));
      this.follow(c.id, job.id);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(null);
    }
  }

  /** Acompanha a geração até virar rascunho. */
  private follow(clusterId: string, jobId: string): void {
    setTimeout(async () => {
      try {
        const job = await this.api.generateJob(jobId);
        const item = job.items[0];
        if (!job.done) {
          const steps: Record<string, string> = { escrevendo: 'Claude escrevendo…', revisando: 'Jev avaliando…', reescrevendo: 'Claude reescrevendo…', midia: 'Buscando mídia…' };
          this.jobs.update((m) => ({ ...m, [clusterId]: steps[item.step] ?? 'Na fila…' }));
          return this.follow(clusterId, jobId);
        }
        this.jobs.update((m) => Object.fromEntries(Object.entries(m).filter(([k]) => k !== clusterId)));
        if (item.error) this.error.set(item.error);
        else this.message.set(`Rascunho criado: "${item.title ?? item.theme}"${item.grades.length ? ` (nota do Jev ${item.grades.at(-1)})` : ''}.`);
        await this.load(this.id(), false);
      } catch (e) {
        this.error.set(errorMessage(e));
      }
    }, 2000);
  }

  async ignore(c: RadarCluster): Promise<void> {
    try {
      await this.api.setRadarStatus(this.id(), c.id, 'ignorado');
      this.view.update((v) => (v ? { ...v, clusters: v.clusters.filter((x) => x.id !== c.id) } : v));
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }
}
