import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { Api, Artifact, Draft, PostType, PublishRequest, errorMessage } from '../../core/api';
import { JevReview } from '../../shared/jev-review';
import {
  CAPTION_MAX,
  CAROUSEL_MAX,
  HASHTAG_MAX,
  HASHTAG_SOFT,
  LocalMedia,
  countHashtags,
  cropToFeed,
  isVideoFile,
  loadImage,
  loadVideo,
  release,
} from '../../core/media-files';
import { ClaudePanel, ClaudeUse, applyClaudeText } from '../../shared/claude-panel';
import { TextCard } from './text-card';

type Status = 'idle' | 'working' | 'done' | 'scheduled' | 'error';

/** Valor para <input type="datetime-local"> no fuso do PC. */
const localInput = (ms: number) => {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
};

const ACCEPT: Record<PostType, string> = {
  image: 'image/*',
  carousel: 'image/*,video/mp4,video/quicktime,.mov',
  reel: 'video/mp4,video/quicktime,.mp4,.mov',
  story: 'image/*,video/mp4,video/quicktime,.mov',
};

@Component({
  selector: 'app-composer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TextCard, ClaudePanel, JevReview],
  template: `
    <section class="card composer">
      <h2>Nova publicação</h2>

      <div class="segmented" role="tablist">
        @for (t of types; track t.value) {
          <button type="button" role="tab" [class.active]="type() === t.value" [title]="t.help"
                  [disabled]="busy()" (click)="setType(t.value)">
            {{ t.label }}
          </button>
        }
      </div>
      <p class="muted small">{{ hint() }}</p>
      @if (loadingMedia()) { <p class="alert info"><span class="spinner"></span> Baixando as fotos/vídeos escolhidos no rascunho…</p> }

      <!-- Mídias -->
      <div class="media-grid">
        @for (m of items(); track m.key; let i = $index) {
          <figure class="thumb">
            @if (m.kind === 'image') {
              <img [src]="m.previewUrl" alt="" />
            } @else {
              <video [src]="m.previewUrl" muted playsinline controls></video>
            }
            <figcaption>
              @if (type() === 'carousel') {
                <span class="badge">{{ i + 1 }}</span>
                <button type="button" class="icon" title="Mover para a esquerda"
                        [disabled]="i === 0 || busy()" (click)="move(i, -1)">‹</button>
                <button type="button" class="icon" title="Mover para a direita"
                        [disabled]="i === items().length - 1 || busy()" (click)="move(i, 1)">›</button>
              }
              @if (m.duration) {
                <span class="small">{{ m.duration.toFixed(0) }}s</span>
              }
              <button type="button" class="icon danger" title="Remover" [disabled]="busy()"
                      (click)="remove(i)">✕</button>
            </figcaption>
            @if (m.warning) {
              <p class="warn-text">{{ m.warning }}</p>
            }
          </figure>
        }

        @if (canAddMore()) {
          <label class="add-tile" [class.disabled]="busy()">
            <input type="file" hidden [accept]="accept()" [multiple]="type() === 'carousel'"
                   [disabled]="busy()" (change)="onFiles($event)" />
            <span class="plus">+</span>
            <span>{{ type() === 'reel' ? 'Escolher vídeo' : 'Adicionar mídia' }}</span>
          </label>
          @if (type() !== 'reel') {
            <button title="Cria uma imagem a partir de um texto (para post só de texto)" type="button" class="add-tile" [disabled]="busy()" (click)="showTextCard.set(true)">
              <span class="plus">Aa</span>
              <span>Criar card de texto</span>
            </button>
          }
        }
      </div>

      @if (showTextCard()) {
        <div class="subcard">
          <app-text-card [initialFormat]="type() === 'story' ? 'story' : 'portrait'" (created)="addGenerated($event)" (cancelled)="showTextCard.set(false)" />
        </div>
      }

      @if (type() === 'reel') {
        <div class="reel-options">
          <label class="check">
            <input type="checkbox" [checked]="shareToFeed()" [disabled]="busy()"
                   (change)="shareToFeed.set($any($event.target).checked)" />
            Mostrar também no feed
          </label>
          <label class="check" title="O Reels é mostrado primeiro só para quem não te segue. Você decide no app se ele vai para os seguidores.">
            <input type="checkbox" [checked]="trial()" [disabled]="busy()"
                   (change)="trial.set($any($event.target).checked)" />
            Trial Reels (testar com não seguidores)
          </label>
          <label class="field audio">
            <span>Nome do áudio original (opcional)</span>
            <input type="text" maxlength="80" [value]="audioName()" [disabled]="busy()"
                   (input)="audioName.set($any($event.target).value)" placeholder="Ex.: Som original" />
          </label>
          <div class="cover">
            @if (cover(); as c) {
              <img [src]="c.previewUrl" alt="Capa" />
              <button title="Volta a usar o primeiro quadro do vídeo como capa" type="button" class="btn ghost" [disabled]="busy()" (click)="setCover(null)">Remover capa</button>
            } @else {
              <label class="btn ghost">
                <input type="file" hidden accept="image/*" [disabled]="busy()" (change)="onCover($event)" />
                Escolher capa (opcional)
              </label>
            }
          </div>
        </div>
      }

      <!-- Legenda (Story não tem legenda pela API) -->
      @if (type() === 'story') {
        <p class="alert info small">Story não tem legenda: o texto vai na própria imagem. Use "Criar card de texto" (formato
          Story 9:16) ou uma arte sua. Enquete e figurinhas, só pelo app do Instagram.</p>
      } @else {
      <label class="field">
        <span>Legenda</span>
        <textarea rows="7" [value]="caption()" [disabled]="busy()"
                  (input)="caption.set($any($event.target).value)"
                  placeholder="Escreva a legenda, chamada para ação e hashtags…"></textarea>
      </label>
      <p class="counters small" [class.over]="captionTooLong() || tooManyHashtags()">
        {{ caption().length }}/{{ captionMax }} caracteres · {{ hashtags() }} hashtags
      </p>
      @if (hashtags() > hashtagSoft && !tooManyHashtags()) {
        <p class="alert warn small">
          Mais de {{ hashtagSoft }} hashtags: o Instagram vem limitando/ignorando excessos. Prefira até {{ hashtagSoft }}
          bem específicas e palavras-chave no texto (veja Ajuda › Algoritmo).
        </p>
      }

      <app-claude-panel [accountId]="accountId()" [currentText]="caption()"
                        [artifacts]="claudeArtifacts()" (use)="useClaude($event)" />
      <app-jev-review [accountId]="accountId()" [caption]="caption()" [kind]="type()" />
      }

      @if (status() === 'error') {
        <p class="alert error">{{ message() }}</p>
      }
      @if (status() === 'working') {
        <p class="alert info"><span class="spinner"></span> {{ message() }}</p>
      }
      @if (status() === 'scheduled') {
        <p class="alert ok">{{ message() }} Acompanhe na aba Agendados.</p>
      }
      @if (status() === 'done') {
        <p class="alert ok">
          Publicado!
          @if (permalink()) {
            <a [href]="permalink()" target="_blank" rel="noopener">Ver no Instagram</a>
          }
        </p>
      }

      <div class="actions">
        <label class="schedule" title="Data e hora para publicar sozinho (o dashboard e o túnel precisam estar ligados nesse horário)">
          <span class="small muted">Agendar para</span>
          <input type="datetime-local" [value]="scheduleAt()" [min]="minSchedule()" [disabled]="busy()"
                 (input)="scheduleAt.set($any($event.target).value)" aria-label="Data e hora do agendamento" />
        </label>
        <button title="Envia a mídia agora e publica sozinho no horário escolhido" type="button" class="btn ghost"
                [disabled]="!canSchedule()" (click)="schedule()">Agendar</button>
        <span class="spacer"></span>
        <button title="Apaga mídias e legenda deste editor" type="button" class="btn ghost" [disabled]="busy() || !dirty()" (click)="reset()">Limpar</button>
        <button title="Publica agora no Instagram (precisa do túnel aberto)" type="button" class="btn primary" [disabled]="!canPublish()" (click)="publish()">
          Publicar agora
        </button>
      </div>
    </section>
  `,
  styleUrl: './composer.scss',
})
export class Composer {
  private api = inject(Api);

  readonly accountId = input.required<string>();
  readonly connected = input(false);
  /** Rascunho de origem: preenche tipo e legenda e é marcado como publicado ao final. */
  readonly draft = input<Draft | null>(null);
  readonly published = output<void>();

  protected readonly types: { value: PostType; label: string; help: string }[] = [
    { value: 'image', label: 'Post estático', help: '1 foto (ou card de texto) no feed' },
    { value: 'carousel', label: 'Carrossel', help: 'De 2 a 20 fotos e/ou vídeos que a pessoa desliza' },
    { value: 'reel', label: 'Reels', help: '1 vídeo vertical; é o formato que mais alcança gente nova' },
    { value: 'story', label: 'Story', help: '1 foto ou vídeo vertical 9:16, some em 24 h; sem legenda (o texto vai na imagem)' },
  ];
  protected readonly captionMax = CAPTION_MAX;
  protected readonly hashtagSoft = HASHTAG_SOFT;

  protected type = signal<PostType>('image');
  protected items = signal<LocalMedia[]>([]);
  protected cover = signal<LocalMedia | null>(null);
  protected caption = signal('');
  protected shareToFeed = signal(true);
  protected trial = signal(false);
  protected audioName = signal('');
  protected claudeArtifacts = computed<Artifact[]>(() =>
    this.type() === 'reel'
      ? ['legenda', 'roteiro', 'ganchos', 'som', 'hashtags', 'melhorar', 'livre']
      : this.type() === 'carousel'
        ? ['legenda', 'carrossel', 'ganchos', 'hashtags', 'melhorar', 'livre']
        : ['legenda', 'card', 'ganchos', 'hashtags', 'melhorar', 'livre'],
  );
  protected showTextCard = signal(false);
  protected loadingMedia = signal(false);
  protected status = signal<Status>('idle');
  protected message = signal('');
  protected permalink = signal<string | undefined>(undefined);

  protected busy = computed(() => this.status() === 'working');
  protected accept = computed(() => ACCEPT[this.type()]);
  protected hashtags = computed(() => countHashtags(this.caption()));
  protected captionTooLong = computed(() => this.caption().length > CAPTION_MAX);
  protected tooManyHashtags = computed(() => this.hashtags() > HASHTAG_MAX);
  protected dirty = computed(() => this.items().length > 0 || this.caption().length > 0 || !!this.cover());

  protected hint = computed(() => {
    switch (this.type()) {
      case 'image':
        return '1 imagem (JPEG/PNG — convertida para JPEG). Proporção de 4:5 a 1.91:1. Sem imagem? Crie um card de texto.';
      case 'carousel':
        return `De 2 a ${CAROUSEL_MAX} imagens e/ou vídeos. Todos são cortados na proporção do primeiro.`;
      case 'reel':
        return '1 vídeo MP4/MOV, vertical 9:16 recomendado. O Instagram processa o vídeo antes de publicar (pode levar minutos).';
      case 'story':
        return '1 imagem ou 1 vídeo vertical 9:16 (vídeo até 60 s). Fica no ar por 24 horas.';
    }
  });

  protected canAddMore = computed(() => {
    const n = this.items().length;
    return this.type() === 'carousel' ? n < CAROUSEL_MAX : n === 0;
  });

  /** Mídia e legenda prontas (vale para publicar e para agendar). */
  private ready = computed(() => {
    if (this.busy() || this.captionTooLong() || this.tooManyHashtags()) return false;
    const n = this.items().length;
    return this.type() === 'carousel' ? n >= 2 && n <= CAROUSEL_MAX : n === 1;
  });
  protected canPublish = computed(() => this.connected() && this.ready());
  protected scheduleAt = signal('');
  protected minSchedule = () => localInput(Date.now() + 2 * 60_000);
  protected canSchedule = computed(() => this.ready() && !!this.scheduleAt() && Date.parse(this.scheduleAt()) > Date.now() + 60_000);

  setType(type: PostType): void {
    if (type === this.type()) return;
    // Mantém só o que serve no novo formato.
    const keep = this.items().filter((m) => (type === 'reel' ? m.kind === 'video' : type === 'image' ? m.kind === 'image' : true));
    if (type === 'story') keep.forEach((m) => (m.warning = m.width > m.height ? 'Horizontal: no Story fica com faixas. Prefira vertical 9:16.' : undefined));
    const limit = type === 'carousel' ? CAROUSEL_MAX : 1;
    this.items().filter((m) => !keep.slice(0, limit).includes(m)).forEach(release);
    this.items.set(keep.slice(0, limit));
    if (type !== 'reel') this.setCover(null);
    this.showTextCard.set(false);
    this.type.set(type);
    this.clearStatus();
  }

  constructor() {
    // Vindo de um rascunho: já abre no formato e com o texto dele.
    effect(() => {
      const d = this.draft();
      if (!d) return;
      untracked(() => {
        this.setType(d.kind === 'carousel' ? 'carousel' : d.kind === 'reel' ? 'reel' : d.kind === 'story' ? 'story' : 'image');
        this.caption.set(d.body);
        this.loadDraftMedia(d);
      });
    });
  }

  /** Mídia escolhida no rascunho (banco de imagens): entra como se fosse um arquivo enviado; fotos cortadas para o feed. */
  private async loadDraftMedia(d: Draft): Promise<void> {
    const chosen = (d.media ?? []).filter((m) => m.selected);
    if (!chosen.length) return;
    this.loadingMedia.set(true);
    try {
      for (const m of chosen) {
        const blob = await this.api.stockFile(m.download);
        const file = new File([blob], `${m.id}.${m.kind === 'video' ? 'mp4' : 'jpg'}`, { type: blob.type });
        await this.addFiles([m.kind === 'photo' ? await cropToFeed(file) : file]);
        if (m.track) this.api.trackStock(m.track).catch(() => undefined); // regra do Unsplash
      }
    } catch (e) {
      this.fail(`Não consegui baixar a mídia do rascunho: ${errorMessage(e)}`);
    } finally {
      this.loadingMedia.set(false);
    }
  }

  useClaude(use: ClaudeUse): void {
    this.caption.update((c) => applyClaudeText(c, use));
  }

  async onFiles(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    await this.addFiles(files);
  }

  async addGenerated(file: File): Promise<void> {
    await this.addFiles([file]);
    if (!this.canAddMore()) this.showTextCard.set(false);
  }

  private async addFiles(files: File[]): Promise<void> {
    this.clearStatus();
    for (const file of files) {
      if (!this.canAddMore()) {
        this.fail(`Limite de itens atingido para ${this.types.find((t) => t.value === this.type())!.label}.`);
        return;
      }
      const video = isVideoFile(file);
      if (this.type() === 'reel' && !video) return this.fail('Reels aceita apenas vídeo.');
      if (this.type() === 'image' && video) return this.fail('Post estático aceita apenas imagem. Para vídeo use Reels.');
      try {
        const media = video ? await loadVideo(file) : await loadImage(file);
        // Story é vertical: o aviso de proporção do feed não vale; avisa se vier horizontal.
        if (this.type() === 'story') media.warning = media.width > media.height ? 'Horizontal: no Story fica com faixas. Prefira vertical 9:16.' : undefined;
        this.items.update((list) => [...list, media]);
      } catch (e) {
        return this.fail((e as Error).message);
      }
    }
  }

  async onCover(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      this.setCover(await loadImage(file));
    } catch (e) {
      this.fail((e as Error).message);
    }
  }

  setCover(media: LocalMedia | null): void {
    const old = this.cover();
    if (old) release(old);
    this.cover.set(media);
  }

  move(index: number, delta: number): void {
    this.items.update((list) => {
      const next = [...list];
      [next[index], next[index + delta]] = [next[index + delta], next[index]];
      return next;
    });
  }

  remove(index: number): void {
    release(this.items()[index]);
    this.items.update((list) => list.filter((_, i) => i !== index));
  }

  reset(): void {
    this.items().forEach(release);
    this.items.set([]);
    this.setCover(null);
    this.caption.set('');
    this.trial.set(false);
    this.audioName.set('');
    this.showTextCard.set(false);
  }

  /** Envia as mídias para o backend e monta o pedido de publicação. */
  private async uploadRequest(uploaded: string[]): Promise<PublishRequest> {
    const media = this.items();
    for (const [i, m] of media.entries()) {
      this.message.set(`Enviando mídia ${i + 1} de ${media.length}…`);
      uploaded.push((await this.api.upload(m.file)).file);
    }
    let coverItem: string | undefined;
    const cover = this.cover();
    if (cover) {
      this.message.set('Enviando capa…');
      coverItem = (await this.api.upload(cover.file)).file;
      uploaded.push(coverItem);
    }
    return {
      type: this.type(),
      caption: this.type() === 'story' ? '' : this.caption(),
      items: uploaded.slice(0, media.length),
      coverItem,
      shareToFeed: this.shareToFeed(),
      trial: this.type() === 'reel' && this.trial(),
      audioName: this.type() === 'reel' ? this.audioName() : undefined,
    };
  }

  async schedule(): Promise<void> {
    const at = Date.parse(this.scheduleAt());
    const uploaded: string[] = [];
    this.status.set('working');
    try {
      const request = await this.uploadRequest(uploaded);
      this.message.set('Agendando…');
      await this.api.schedule(this.accountId(), { request, at, draftId: this.draft()?.id });
      this.reset();
      this.scheduleAt.set('');
      this.message.set(`Agendado para ${new Date(at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}.`);
      this.status.set('scheduled');
    } catch (e) {
      uploaded.forEach((f) => this.api.deleteUpload(f).catch(() => undefined));
      this.fail(errorMessage(e));
    }
  }

  async publish(): Promise<void> {
    const accountId = this.accountId();
    const uploaded: string[] = [];
    this.status.set('working');
    this.permalink.set(undefined);
    try {
      const request = await this.uploadRequest(uploaded);
      this.message.set(
        this.type() === 'image'
          ? 'Publicando no Instagram…'
          : 'Publicando no Instagram… vídeos e carrosséis podem levar alguns minutos. Não feche a página.',
      );
      const result = await this.api.publish(accountId, request);
      const draft = this.draft();
      if (draft) await this.api.updateDraft(draft.id, { status: 'publicado' }).catch(() => undefined);
      this.reset();
      this.permalink.set(result.permalink);
      this.status.set('done');
      this.published.emit();
    } catch (e) {
      // O backend só apaga a mídia quando publica; em caso de falha limpamos aqui.
      uploaded.forEach((f) => this.api.deleteUpload(f).catch(() => undefined));
      this.fail(errorMessage(e));
    }
  }

  private fail(message: string): void {
    this.message.set(message);
    this.status.set('error');
  }

  private clearStatus(): void {
    if (this.status() !== 'working') this.status.set('idle');
  }
}
