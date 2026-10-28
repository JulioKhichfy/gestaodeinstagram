import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { HELP, HelpSection } from './help-content';

const normalize = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

@Component({
  selector: 'app-help',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="head">
      <h1>Ajuda</h1>
      <p class="muted">Tudo sobre o dashboard, o algoritmo do Instagram, métricas, Claude e tráfego pago.</p>
      <input type="search" class="search" placeholder="Buscar: hashtags, Reels, impulsionar, score, senha…"
             [value]="query()" (input)="query.set($any($event.target).value)" aria-label="Buscar na ajuda" />
    </header>

    <div class="layout">
      <nav class="toc" aria-label="Seções">
        @for (s of sections(); track s.id) {
          <a [href]="'#' + s.id" (click)="go($event, s.id)">{{ s.title }} <small class="muted">({{ s.items.length }})</small></a>
        }
      </nav>

      <div class="content">
        @for (s of sections(); track s.id) {
          <section class="card" [id]="s.id">
            <h2>{{ s.title }}</h2>
            @if (s.intro) { <p class="intro">{{ s.intro }}</p> }
            @for (item of s.items; track item.q) {
              <details [open]="!!query()">
                <summary>{{ item.q }}</summary>
                <div class="answer">
                  @for (block of blocks(item.a); track $index) {
                    @if (block.list) {
                      <ul>@for (li of block.lines; track $index) { <li>{{ li }}</li> }</ul>
                    } @else {
                      <p>{{ block.lines[0] }}</p>
                    }
                  }
                </div>
              </details>
            }
          </section>
        } @empty {
          <p class="muted">Nada encontrado para “{{ query() }}”. Tente outra palavra.</p>
        }
      </div>
    </div>
  `,
  styles: `
    .head { display: grid; gap: 6px; margin-bottom: 16px; }
    h1 { margin: 0; font-size: 1.4rem; }
    .head p { margin: 0; }
    .search { max-width: 520px; }
    .layout { display: grid; grid-template-columns: 220px 1fr; gap: 20px; align-items: start; }
    .toc { position: sticky; top: 12px; display: grid; gap: 2px;
      a { padding: 6px 8px; border-radius: 6px; text-decoration: none; color: var(--text); font-size: .9rem; }
      a:hover { background: var(--surface-2); } }
    .content { display: grid; gap: 16px; min-width: 0; }
    h2 { margin: 0 0 8px; font-size: 1.1rem; }
    .intro { color: var(--muted); margin: 0 0 8px; }
    details { border-top: 1px solid var(--border); padding: 10px 0; }
    summary { cursor: pointer; font-weight: 600; }
    .answer { padding: 6px 0 0 18px; }
    .answer p { margin: 6px 0; }
    .answer ul { margin: 6px 0; padding-left: 20px; display: grid; gap: 4px; }
    @media (max-width: 800px) { .layout { grid-template-columns: 1fr; } .toc { position: static; grid-template-columns: repeat(2, 1fr); } }
  `,
})
export class HelpPage {
  protected query = signal('');

  protected sections = computed<HelpSection[]>(() => {
    const q = normalize(this.query().trim());
    if (!q) return HELP;
    return HELP.map((s) => ({
      ...s,
      items: s.items.filter((i) => normalize([s.title, i.q, ...i.a].join(' ')).includes(q)),
    })).filter((s) => s.items.length);
  });

  /** Agrupa linhas "- " consecutivas em listas. */
  protected blocks(lines: string[]): { list: boolean; lines: string[] }[] {
    const out: { list: boolean; lines: string[] }[] = [];
    for (const line of lines) {
      const isItem = line.startsWith('- ');
      const last = out.at(-1);
      if (isItem && last?.list) last.lines.push(line.slice(2));
      else out.push({ list: isItem, lines: [isItem ? line.slice(2) : line] });
    }
    return out;
  }

  go(event: Event, id: string): void {
    event.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
