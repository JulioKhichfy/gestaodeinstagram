import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api, PostType, ScheduleStatus, ScheduledPost, errorMessage } from '../../core/api';

const TYPE_LABELS: Record<PostType, string> = { image: 'Post estático', carousel: 'Carrossel', reel: 'Reels', story: 'Story' };
const STATUS_LABELS: Record<ScheduleStatus, string> = {
  agendado: 'Agendado',
  publicando: 'Publicando…',
  publicado: 'Publicado',
  falhou: 'Falhou',
  cancelado: 'Cancelado',
};

const when = (ms: number) => new Date(ms).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const localInput = (ms: number) => new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

/** Agendados: o que vai sair e quando; o que saiu ou falhou nos últimos 30 dias. */
@Component({
  selector: 'app-agenda',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <section class="card">
      <h2>Agendados</h2>
      <p class="muted small">O dashboard confere a cada minuto e publica o que chegou na hora. Para funcionar,
        <strong>o dashboard e o túnel precisam estar ligados no horário</strong> (a Meta baixa a mídia do seu PC).
        Se estiverem desligados, o post fica como "Falhou" e você publica com um clique depois. Para agendar, monte o post em
        <a [routerLink]="['..', 'publicar']">Publicar</a> e use "Agendar".</p>
      @if (error()) { <p class="alert error">{{ error() }}</p> }
    </section>

    <section class="card">
      <h3>Próximos ({{ upcoming().length }})</h3>
      @for (p of upcoming(); track p.id) {
        <article class="item">
          <div class="when">
            <strong>{{ when(p.scheduledAt) }}</strong>
            <span class="badge" [class]="'badge ' + p.status">{{ statusLabels[p.status] }}</span>
          </div>
          <div class="what">
            <span><strong>{{ typeLabels[p.type] }}</strong> · {{ p.items }} mídia(s)</span>
            <span class="muted caption">{{ p.caption || (p.type === 'story' ? '(Story: o texto está na imagem)' : '(sem legenda)') }}</span>
            @if (p.error) { <span class="error-text">{{ p.error }}</span> }
          </div>
          <div class="actions">
            @if (editing() === p.id) {
              <input type="datetime-local" [value]="newAt()" [min]="minAt()" (input)="newAt.set($any($event.target).value)" aria-label="Novo horário" />
              <button type="button" class="btn primary" (click)="saveAt(p)" title="Salvar o novo horário">Salvar</button>
              <button type="button" class="btn ghost" (click)="editing.set(null)" title="Não mudar">Cancelar</button>
            } @else {
              <button type="button" class="btn ghost" [disabled]="busy() === p.id" (click)="edit(p)" title="Mudar data e hora">Reagendar</button>
              <button type="button" class="btn ghost" [disabled]="busy() === p.id" (click)="publishNow(p)" title="Publica agora no Instagram (precisa do túnel aberto)">
                @if (busy() === p.id) { <span class="spinner"></span> } Publicar agora
              </button>
              <button type="button" class="btn ghost danger" [disabled]="busy() === p.id" (click)="cancel(p)" title="Não publicar e apagar a mídia enviada">Cancelar</button>
            }
          </div>
        </article>
      } @empty {
        <p class="muted">Nada agendado.</p>
      }
    </section>

    @if (history().length) {
      <section class="card">
        <h3>Últimos 30 dias</h3>
        @for (p of history(); track p.id) {
          <article class="item past">
            <div class="when">
              <span>{{ when(p.publishedAt ?? p.scheduledAt) }}</span>
              <span class="badge" [class]="'badge ' + p.status">{{ statusLabels[p.status] }}</span>
            </div>
            <div class="what">
              <span><strong>{{ typeLabels[p.type] }}</strong> · <span class="muted caption">{{ p.caption || '—' }}</span></span>
            </div>
            <div class="actions">
              @if (p.permalink) { <a [href]="p.permalink" target="_blank" rel="noopener" title="Abrir no Instagram">Ver no Instagram ↗</a> }
            </div>
          </article>
        }
      </section>
    }
  `,
  styles: `
    :host { display: grid; gap: 12px; }
    h2 { margin: 0 0 4px; font-size: 1.1rem; }
    h3 { margin: 0 0 8px; font-size: 1rem; }
    .small { font-size: .85rem; margin: 0; }
    .item { display: grid; grid-template-columns: 190px 1fr auto; gap: 12px; align-items: center; padding: 10px 0; border-top: 1px solid var(--border); }
    .when { display: grid; gap: 4px; justify-items: start; }
    .what { display: grid; gap: 2px; min-width: 0; }
    .caption { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .actions { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; align-items: center; }
    .badge { font-size: .75rem; border: 1px solid var(--border); border-radius: 999px; padding: 2px 8px;
      &.publicado { background: var(--ok-bg); color: var(--ok-text); border-color: transparent; }
      &.falhou { background: var(--warn-bg); color: var(--warn-text); border-color: transparent; }
      &.agendado { border-color: var(--accent); color: var(--accent); } }
    .error-text { color: var(--danger, #c0392b); font-size: .85rem; }
    @media (max-width: 760px) { .item { grid-template-columns: 1fr; } .actions { justify-content: flex-start; } }
  `,
})
export class AgendaPage {
  private api = inject(Api);

  readonly id = input.required<string>();

  protected readonly typeLabels = TYPE_LABELS;
  protected readonly statusLabels = STATUS_LABELS;
  protected readonly when = when;
  protected minAt = () => localInput(Date.now() + 2 * 60_000);

  protected posts = signal<ScheduledPost[]>([]);
  protected error = signal('');
  protected busy = signal<number | null>(null);
  protected editing = signal<number | null>(null);
  protected newAt = signal('');
  protected upcoming = computed(() => this.posts().filter((p) => ['agendado', 'publicando', 'falhou'].includes(p.status)));
  protected history = computed(() => this.posts().filter((p) => ['publicado', 'cancelado'].includes(p.status)));

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => this.load(id));
    });
    // Atualiza sozinho: um agendado pode virar publicado enquanto a tela está aberta.
    const timer = setInterval(() => this.load(this.id()), 30_000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  private async load(id: string): Promise<void> {
    try {
      this.posts.set(await this.api.scheduleList(id));
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  edit(p: ScheduledPost): void {
    this.editing.set(p.id);
    this.newAt.set(localInput(Math.max(p.scheduledAt, Date.now() + 5 * 60_000)));
  }

  async saveAt(p: ScheduledPost): Promise<void> {
    await this.run(p, () => this.api.reschedule(p.id, Date.parse(this.newAt())));
    this.editing.set(null);
  }

  publishNow(p: ScheduledPost): Promise<void> {
    return this.run(p, () => this.api.publishScheduled(p.id));
  }

  async cancel(p: ScheduledPost): Promise<void> {
    if (!confirm('Cancelar este agendamento? A mídia enviada será apagada.')) return;
    await this.run(p, () => this.api.cancelScheduled(p.id));
  }

  private async run(p: ScheduledPost, action: () => Promise<ScheduledPost>): Promise<void> {
    this.busy.set(p.id);
    this.error.set('');
    try {
      const updated = await action();
      this.posts.update((list) => list.map((x) => (x.id === updated.id ? updated : x)));
      if (updated.status === 'falhou' && updated.error) this.error.set(updated.error);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(null);
    }
  }
}
