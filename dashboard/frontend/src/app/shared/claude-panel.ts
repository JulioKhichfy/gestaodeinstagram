import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { Api, Artifact, ClaudeMessage, errorMessage } from '../core/api';

export const ARTIFACT_LABELS: Record<Artifact, string> = {
  legenda: 'Legenda',
  roteiro: 'Roteiro de Reels',
  carrossel: 'Textos do carrossel',
  card: 'Texto de card',
  ganchos: 'Ganchos',
  hashtags: 'Hashtags e palavras-chave',
  som: 'Som / áudio',
  ideias: 'Ideias de conteúdo',
  melhorar: 'Melhorar texto',
  analise: 'Analisar resultados',
  trafego: 'Impulsionamento',
  livre: 'Pedido livre',
};

/**
 * Campo "Pedir ao Claude": usa a assinatura do Claude da usuária (Claude Code no PC).
 * O Claude recebe o perfil da conta (claude.md), as métricas e o texto atual do artefato.
 */
@Component({
  selector: 'app-claude-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="claude">
      <header>
        <span class="claude-mark" aria-hidden="true">✦</span>
        <strong>Pedir ao Claude</strong>
        <small class="muted">usa sua assinatura · conhece o perfil e as métricas da conta</small>
      </header>

      <div class="chips" role="radiogroup" aria-label="O que criar">
        @for (a of artifacts(); track a) {
          <button type="button" class="chip" role="radio" [attr.aria-checked]="artifact() === a"
                  [class.active]="artifact() === a" (click)="artifact.set(a)">{{ labels[a] }}</button>
        }
      </div>

      <textarea rows="3" [value]="instruction()" (input)="instruction.set($any($event.target).value)"
                [placeholder]="placeholder()" (keydown.control.enter)="ask()"></textarea>

      <div class="row">
        <small class="muted">
          @if (currentText().trim()) { O texto atual vai junto como contexto. } Ctrl+Enter envia.
        </small>
        <button type="button" class="btn primary" [disabled]="busy()" (click)="ask()">
          @if (busy()) { <span class="spinner"></span> Escrevendo… } @else { Pedir ao Claude }
        </button>
      </div>

      @if (error()) { <p class="alert error">{{ error() }}</p> }

      @if (answer(); as text) {
        <div class="answer">
          <pre>{{ text }}</pre>
          <div class="row end">
            <button type="button" class="btn ghost" (click)="copy(text)">{{ copied() ? 'Copiado!' : 'Copiar' }}</button>
            <button type="button" class="btn ghost" (click)="use.emit({ text, mode: 'append' })">Adicionar ao final</button>
            <button type="button" class="btn primary" (click)="use.emit({ text, mode: 'replace' })">Usar este texto</button>
          </div>
        </div>
      }

      @if (history().length) {
        <details>
          <summary>Histórico com o Claude ({{ history().length / 2 }})</summary>
          @for (m of history(); track m.id) {
            <div class="msg" [class.me]="m.role === 'user'">
              <small class="muted">{{ m.role === 'user' ? 'Você' : 'Claude' }}</small>
              <pre>{{ m.content }}</pre>
            </div>
          }
        </details>
      }
    </section>
  `,
  styles: `
    .claude { display: grid; gap: 10px; border: 1px solid var(--border); border-radius: 12px; padding: 14px;
      background: var(--surface-2); }
    header { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
    .claude-mark { color: #d97757; font-size: 1.1rem; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .row { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; }
    .row.end { justify-content: flex-end; }
    .answer { display: grid; gap: 8px; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 12px; }
    pre { white-space: pre-wrap; font: inherit; margin: 0; }
    details summary { cursor: pointer; color: var(--muted); font-size: .85rem; }
    .msg { padding: 8px 0; border-top: 1px solid var(--border); }
    .msg.me pre { color: var(--muted); }
  `,
})
export class ClaudePanel {
  private api = inject(Api);

  readonly accountId = input.required<string>();
  readonly currentText = input('');
  readonly draftId = input<number | null>(null);
  readonly artifacts = input<Artifact[]>(['legenda', 'ganchos', 'hashtags', 'melhorar', 'livre']);
  readonly initial = input<Artifact | null>(null);
  readonly use = output<{ text: string; mode: 'replace' | 'append' }>();

  protected readonly labels = ARTIFACT_LABELS;
  protected artifact = signal<Artifact>('legenda');
  protected instruction = signal('');
  protected busy = signal(false);
  protected error = signal('');
  protected answer = signal('');
  protected copied = signal(false);
  protected history = signal<ClaudeMessage[]>([]);

  protected placeholder = computed(() =>
    this.artifact() === 'livre'
      ? 'Escreva seu pedido. Ex.: "crie uma legenda para o lançamento do kit de Natal com tom acolhedor"'
      : 'Detalhes opcionais: tema, produto, público, tom, data, oferta…',
  );

  constructor() {
    effect(() => {
      const first = this.initial() ?? this.artifacts()[0];
      untracked(() => this.artifact.set(first));
    });
    effect(() => {
      const id = this.draftId();
      untracked(() => {
        this.history.set([]);
        this.answer.set('');
        if (id) this.api.draftMessages(id).then((m) => this.history.set(m)).catch(() => undefined);
      });
    });
  }

  async ask(): Promise<void> {
    if (this.busy()) return;
    if (this.artifact() === 'livre' && !this.instruction().trim()) {
      this.error.set('Escreva o que você quer pedir.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const { text } = await this.api.askClaude({
        accountId: this.accountId(),
        artifact: this.artifact(),
        instruction: this.instruction(),
        currentText: this.currentText(),
        draftId: this.draftId() ?? undefined,
      });
      this.answer.set(text);
      const id = this.draftId();
      if (id) this.history.set(await this.api.draftMessages(id));
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  async copy(text: string): Promise<void> {
    await navigator.clipboard.writeText(text);
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 1500);
  }
}
