import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { canvasToJpeg } from '../../core/media-files';

type Format = 'portrait' | 'square';

const SIZES: Record<Format, { w: number; h: number }> = {
  portrait: { w: 1080, h: 1350 },
  square: { w: 1080, h: 1080 },
};

const FONTS = {
  sans: '"Helvetica Neue", Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
};

/** Gera uma imagem a partir de texto (o Instagram não aceita post só de texto). */
@Component({
  selector: 'app-text-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="text-card">
      <canvas #canvas class="preview"></canvas>

      <div class="controls">
        <label class="field">
          <span>Texto do card</span>
          <textarea rows="6" [value]="text()" (input)="text.set($any($event.target).value)"
                    placeholder="Escreva a frase, dica ou chamada…"></textarea>
        </label>

        <div class="row">
          <label class="field">
            <span>Fundo</span>
            <input type="color" [value]="bg()" (input)="bg.set($any($event.target).value)" />
          </label>
          <label class="field">
            <span>Texto</span>
            <input type="color" [value]="fg()" (input)="fg.set($any($event.target).value)" />
          </label>
          <label class="field">
            <span>Tamanho</span>
            <input type="range" min="36" max="120" [value]="fontSize()"
                   (input)="fontSize.set(+$any($event.target).value)" />
          </label>
        </div>

        <div class="row">
          <label class="field">
            <span>Fonte</span>
            <select [value]="font()" (change)="font.set($any($event.target).value)">
              <option value="sans">Sem serifa</option>
              <option value="serif">Com serifa</option>
            </select>
          </label>
          <label class="field">
            <span>Alinhamento</span>
            <select [value]="align()" (change)="align.set($any($event.target).value)">
              <option value="center">Centro</option>
              <option value="left">Esquerda</option>
            </select>
          </label>
          <label class="field">
            <span>Formato</span>
            <select [value]="format()" (change)="format.set($any($event.target).value)">
              <option value="portrait">Retrato 4:5</option>
              <option value="square">Quadrado 1:1</option>
            </select>
          </label>
        </div>

        @if (overflow()) {
          <p class="alert warn">O texto passa da área do card. Diminua o tamanho ou o texto.</p>
        }

        <div class="row end">
          <button class="btn ghost" type="button" (click)="cancelled.emit()">Cancelar</button>
          <button class="btn primary" type="button" [disabled]="!text().trim()" (click)="use()">
            Adicionar ao post
          </button>
        </div>
      </div>
    </div>
  `,
  styles: `
    .text-card { display: grid; grid-template-columns: 240px 1fr; gap: 20px; align-items: start; }
    .preview { width: 100%; height: auto; border-radius: 8px; border: 1px solid var(--border); }
    .controls { display: grid; gap: 12px; }
    .row { display: flex; gap: 12px; flex-wrap: wrap; }
    .row .field { flex: 1; min-width: 110px; }
    .row.end { justify-content: flex-end; }
    input[type='color'] { height: 38px; padding: 2px; }
    @media (max-width: 640px) { .text-card { grid-template-columns: 1fr; } .preview { max-width: 240px; } }
  `,
})
export class TextCard {
  readonly created = output<File>();
  readonly cancelled = output<void>();

  protected text = signal('');
  protected bg = signal('#f4efe9');
  protected fg = signal('#2b2b2b');
  protected fontSize = signal(64);
  protected font = signal<keyof typeof FONTS>('serif');
  protected align = signal<'center' | 'left'>('center');
  protected format = signal<Format>('portrait');
  protected overflow = signal(false);

  private canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

  constructor() {
    effect(() => this.draw());
  }

  private draw(): void {
    const canvas = this.canvas().nativeElement;
    const { w, h } = SIZES[this.format()];
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = this.bg();
    ctx.fillRect(0, 0, w, h);

    const size = this.fontSize();
    const pad = 110;
    const lineHeight = size * 1.3;
    ctx.font = `${size}px ${FONTS[this.font()]}`;
    ctx.fillStyle = this.fg();
    ctx.textBaseline = 'top';
    ctx.textAlign = this.align();

    const lines = wrap(ctx, this.text(), w - pad * 2);
    const blockHeight = lines.length * lineHeight;
    this.overflow.set(blockHeight > h - pad * 2);
    const x = this.align() === 'center' ? w / 2 : pad;
    let y = Math.max(pad, (h - blockHeight) / 2);
    for (const line of lines) {
      ctx.fillText(line, x, y);
      y += lineHeight;
    }
  }

  async use(): Promise<void> {
    const blob = await canvasToJpeg(this.canvas().nativeElement);
    this.created.emit(new File([blob], `card-${Date.now()}.jpg`, { type: 'image/jpeg' }));
    this.text.set('');
  }
}

/** Quebra o texto em linhas que cabem na largura, respeitando as quebras digitadas. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines;
}
