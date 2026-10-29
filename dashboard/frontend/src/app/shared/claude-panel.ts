import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { Api, Artifact, ClaudeMessage, errorMessage } from '../core/api';
import { CAPTION_MAX } from '../core/media-files';

/** Pedidos cuja resposta vai para a legenda (os outros podem ser longos). */
const CAPTION_ARTIFACTS = new Set<Artifact>(['legenda', 'melhorar', 'livre']);

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

/** O que cada botão faz e o que fazer com a resposta (aparece abaixo dos botões). */
export const ARTIFACT_HELP: Record<Artifact, string> = {
  legenda: 'Escreve a legenda completa (gancho, texto, chamada para ação e hashtags), com até 1.500 caracteres. "Usar este texto" coloca no campo da legenda.',
  roteiro: 'Roteiro de Reels com gancho, cenas e texto na tela, para você gravar. Guarde no rascunho; a legenda é outro pedido.',
  carrossel: 'Texto de cada slide do carrossel (capa, conteúdo, chamada final). Use para montar as imagens.',
  card: 'Frase curta (até 25 palavras) para virar imagem. Copie e cole em "Criar card de texto".',
  ganchos: '10 opções de primeira frase. Clique em "Usar como 1ª linha" na que preferir: só a 1ª linha da legenda muda.',
  hashtags: 'Hashtags e palavras-chave do nicho. "Adicionar as hashtags ao final" coloca só as hashtags no fim da legenda.',
  som: 'Sugestão de áudio e ritmo para o Reels. É orientação para a gravação; não vai na legenda.',
  ideias: '10 ideias de conteúdo com formato e gancho.',
  melhorar: 'Reescreve o texto que já está no campo (escreva algo antes). Detalhes opcionais: "mais curto", "mais divertido"…',
  analise: 'Lê os números do relatório e sugere conclusões, ações e um experimento.',
  trafego: 'Sugere objetivo, público, orçamento e duração para impulsionar o post.',
  livre: 'Peça o que quiser em poucas palavras. Ex.: "deixe mais curto", "tom mais acolhedor", "3 versões da chamada final".',
};

/** Modos de aplicar a resposta no texto: trocar tudo, somar ao final ou trocar só a 1ª linha. */
export interface ClaudeUse {
  text: string;
  mode: 'replace' | 'append' | 'firstLine';
}

export function applyClaudeText(current: string, { text, mode }: ClaudeUse): string {
  if (mode === 'replace' || !current.trim()) return text;
  if (mode === 'append') return `${current.trimEnd()}\n\n${text}`;
  const lines = current.split('\n');
  lines[0] = text;
  return lines.join('\n');
}

/** "1. Você sabia…?" -> "Você sabia…?" (uma opção por linha numerada ou com hífen). */
export function listOptions(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^(\d+[.)]|[-•])\s+/.test(l))
    .map((l) => l.replace(/^(\d+[.)]|[-•])\s+/, '').replace(/^["“](.*)["”]$/, '$1').trim())
    .filter(Boolean);
}

export const onlyHashtags = (text: string) => (text.match(/#[\p{L}\p{N}_]+/gu) ?? []).join(' ');

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
                  [class.active]="artifact() === a" [title]="help[a]" (click)="artifact.set(a)">{{ labels[a] }}
            @if (answers()[a] && artifact() !== a) { <span class="dot" aria-label="tem resposta">•</span> }</button>
        }
      </div>

      <p class="help muted">{{ help[artifact()] }}</p>

      <textarea rows="3" [value]="instruction()" (input)="instruction.set($any($event.target).value)"
                [placeholder]="placeholder()" (keydown.control.enter)="ask()"></textarea>

      <div class="row">
        <small class="muted">
          @if (currentText().trim()) { O texto atual vai junto como contexto. } Ctrl+Enter envia.
        </small>
        <button title="Envia o pedido ao Claude com o perfil da conta e o texto atual" type="button" class="btn primary" [disabled]="busy()" (click)="ask()">
          @if (busy()) { <span class="spinner"></span> Escrevendo… } @else { Pedir ao Claude }
        </button>
      </div>

      @if (error()) { <p class="alert error">{{ error() }}</p> }

      @if (answer(); as text) {
        <div class="answer">
          @if (answerArtifact() === 'ganchos' && options().length) {
            <ul class="options">
              @for (o of options(); track $index) {
                <li><span>{{ o }}</span>
                  <button title="Troca só a primeira linha da legenda por este gancho" type="button" class="btn ghost" (click)="use.emit({ text: o, mode: 'firstLine' })">Usar como 1ª linha</button></li>
              }
            </ul>
          } @else {
            <pre>{{ text }}</pre>
          }
          <div class="row">
            <small class="muted" [class.too-long]="tooLong()">
              {{ text.length }} caracteres@if (tooLong()) { · passa do limite de {{ captionMax }} da legenda }
            </small>
            <div class="row end">
              <button title="Copia a resposta para colar onde quiser" type="button" class="btn ghost" (click)="copy(text)">{{ copied() ? 'Copiado!' : 'Copiar' }}</button>
              @if (tooLong()) {
                <button title="Pede ao Claude para reduzir para até 1.500 caracteres" type="button" class="btn ghost" [disabled]="busy()" (click)="shorten()">Pedir versão mais curta</button>
              }
              @if (answerArtifact() === 'hashtags') {
                @if (hashtagsOf(text); as tags) {
                  <button title="Coloca só as hashtags no fim do texto" type="button" class="btn primary" (click)="use.emit({ text: tags, mode: 'append' })">Adicionar as hashtags ao final</button>
                }
              } @else if (answerArtifact() !== 'ganchos') {
                <button title="Mantém o seu texto e soma a resposta no fim" type="button" class="btn ghost" (click)="use.emit({ text, mode: 'append' })">Adicionar ao final</button>
                <button title="Troca todo o texto do campo pela resposta" type="button" class="btn primary" (click)="use.emit({ text, mode: 'replace' })">Usar este texto</button>
              }
            </div>
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
    .help { margin: 0; font-size: .85rem; }
    .options { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px;
      li { display: flex; justify-content: space-between; align-items: center; gap: 8px;
        border-bottom: 1px solid var(--border); padding-bottom: 6px; } }
    .too-long { color: var(--danger, #c0392b); font-weight: 600; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .chip .dot { color: var(--accent); margin-left: 2px; }
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
  readonly use = output<ClaudeUse>();

  protected readonly labels = ARTIFACT_LABELS;
  protected readonly help = ARTIFACT_HELP;
  protected readonly captionMax = CAPTION_MAX;
  protected readonly hashtagsOf = onlyHashtags;
  /** A resposta mostrada é sempre a do botão selecionado (os botões de ação dependem dele). */
  protected answerArtifact = computed(() => this.artifact());
  protected artifact = signal<Artifact>('legenda');
  protected instruction = signal('');
  protected busy = signal(false);
  protected error = signal('');
  /** Uma resposta por tipo de pedido: trocar de botão não apaga a resposta do outro. */
  protected answers = signal<Partial<Record<Artifact, string>>>({});
  protected answer = computed(() => this.answers()[this.artifact()] ?? '');
  protected copied = signal(false);
  protected history = signal<ClaudeMessage[]>([]);
  protected options = computed(() => listOptions(this.answer()));
  protected tooLong = computed(() => this.answer().length > CAPTION_MAX && CAPTION_ARTIFACTS.has(this.answerArtifact()));

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
        this.answers.set({});
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
    if (this.artifact() === 'melhorar' && !this.currentText().trim()) {
      this.error.set('Escreva ou cole um texto no campo antes de pedir para melhorar.');
      return;
    }
    await this.request(this.artifact(), this.instruction(), this.currentText());
  }

  /** Resposta passou do limite da legenda: pede ao Claude para encurtar a própria resposta. */
  async shorten(): Promise<void> {
    if (this.busy()) return;
    await this.request(
      'melhorar',
      'Encurte para no máximo 1.500 caracteres, mantendo o gancho, a ideia principal e a chamada para ação.',
      this.answer(),
      this.artifact(),
    );
  }

  /** `storeAs`: em qual botão a resposta fica guardada (encurtar guarda no botão de onde veio). */
  private async request(artifact: Artifact, instruction: string, currentText: string, storeAs: Artifact = artifact): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      const { text } = await this.api.askClaude({
        accountId: this.accountId(),
        artifact,
        instruction,
        currentText,
        draftId: this.draftId() ?? undefined,
      });
      this.answers.update((all) => ({ ...all, [storeAs]: text }));
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
