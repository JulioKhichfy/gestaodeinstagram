import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { AccountsStore } from '../../core/accounts';
import { Api, Draft, MediaItem } from '../../core/api';
import { Composer } from './composer';

@Component({
  selector: 'app-publish',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Composer, DatePipe],
  template: `
    @if (account(); as acc) {
      @if (publishMissing(); as missing) {
        <p class="alert warn">
          <strong>Publicar está desligado neste PC.</strong> O Instagram precisa baixar a foto ou o vídeo de um endereço
          público. Falta no <code>backend/.env</code>: {{ missing }}. Você ainda pode montar o post, revisar a legenda com o Jev
          e salvar como rascunho.
        </p>
      }
      @if (draft(); as d) {
        <p class="alert info">Publicando o rascunho <strong>“{{ d.title }}”</strong>. Adicione as mídias e confira a legenda.</p>
      }
      <!-- Recria o editor ao trocar de conta: um rascunho nunca vai para a conta errada. -->
      @for (key of [acc.id + ':' + (draft()?.id ?? '')]; track key) {
        <app-composer [accountId]="acc.id" [connected]="acc.connected" [draft]="draft()" (published)="loadMedia()" />
      }

      @if (acc.connected) {
        <section class="card">
          <h2>Publicações recentes</h2>
          @if (media().length) {
            <div class="feed">
              @for (m of media(); track m.id) {
                <a class="post" [href]="m.permalink" target="_blank" rel="noopener" [title]="m.caption ?? ''">
                  <img [src]="m.media_type === 'VIDEO' ? m.thumbnail_url : m.media_url" alt="" loading="lazy" />
                  <span class="type">
                    @switch (m.media_type) {
                      @case ('VIDEO') { Reels }
                      @case ('CAROUSEL_ALBUM') { Carrossel }
                      @default { Post }
                    }
                  </span>
                  <span class="meta">
                    {{ m.timestamp | date: 'dd/MM/yy' }}
                    @if (m.like_count !== undefined) { · ♥ {{ m.like_count }} }
                    @if (m.comments_count !== undefined) { · 💬 {{ m.comments_count }} }
                  </span>
                </a>
              }
            </div>
          } @else {
            <p class="muted">{{ loading() ? 'Carregando…' : 'Nenhuma publicação encontrada.' }}</p>
          }
        </section>
      }
    }
  `,
  styles: `
    :host { display: grid; gap: 20px; }
    h2 { margin: 0 0 16px; font-size: 1.1rem; }
    .feed { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
    .post { position: relative; display: block; border-radius: 8px; overflow: hidden; color: #fff; text-decoration: none;
      background: var(--surface-2);
      img { display: block; width: 100%; aspect-ratio: 3 / 4; object-fit: cover; }
      .type { position: absolute; top: 6px; left: 6px; font-size: .7rem; background: rgb(0 0 0 / .55); padding: 2px 6px; border-radius: 4px; }
      .meta { position: absolute; inset: auto 0 0; padding: 18px 8px 6px; font-size: .75rem;
        background: linear-gradient(transparent, rgb(0 0 0 / .7)); } }
  `,
})
export class PublishPage {
  private api = inject(Api);
  private store = inject(AccountsStore);

  readonly id = input.required<string>();
  /** ?rascunho=ID vindo da página de rascunhos. */
  readonly rascunho = input<string>();

  protected account = computed(() => this.store.byId(this.id()));
  protected media = signal<MediaItem[]>([]);
  protected loading = signal(false);
  protected draft = signal<Draft | null>(null);
  protected publishMissing = signal<string | null>(null);

  constructor() {
    this.api
      .config()
      .then((c) => this.publishMissing.set(c.publishMissing))
      .catch(() => undefined);
    effect(() => {
      const id = this.id();
      const connected = this.account()?.connected ?? false;
      untracked(() => (connected ? this.loadMedia() : this.media.set([])));
      void id;
    });
    effect(() => {
      const id = this.id();
      const draftId = Number(this.rascunho());
      untracked(() => {
        this.draft.set(null);
        if (draftId) this.api.drafts(id).then((list) => this.draft.set(list.find((d) => d.id === draftId) ?? null));
      });
    });
  }

  async loadMedia(): Promise<void> {
    this.loading.set(true);
    try {
      this.media.set(await this.api.media(this.id()));
    } catch {
      this.media.set([]);
    } finally {
      this.loading.set(false);
    }
  }
}
