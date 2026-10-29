import { ChangeDetectionStrategy, Component, effect, inject, input, signal, untracked } from '@angular/core';
import { AccountsStore } from '../../core/accounts';
import { Api, Cycle, errorMessage } from '../../core/api';
import { dateBR, dec, delta, num, todayIso } from '../../core/format';

const PHASES = [
  { key: 'pesquisa', label: 'Pesquisa', days: [1, 2, 3], help: 'Olhe os dados, as referências do nicho e defina hipóteses.' },
  { key: 'testes', label: 'Testes', days: [4, 5, 6, 7], help: 'Publique as variações (formato, gancho, estilo) e registre cada uma.' },
  { key: 'analise', label: 'Análise', days: [8, 9, 10], help: 'Compare os resultados, escolha a vencedora e planeje o próximo ciclo.' },
] as const;

@Component({
  selector: 'app-cycles',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card">
      <h2>Novo ciclo de 10 dias</h2>
      <p class="muted small">Pesquisa (dias 1-3) → Testes (4-7) → Análise (8-10). Um ciclo por vez ajuda a aprender rápido o que funciona.</p>
      <form class="new" (submit)="create($event)">
        <label class="field"><span>Início</span><input name="startDate" type="date" [value]="today" required /></label>
        <label class="field grow"><span>Objetivo do ciclo</span>
          <input name="objective" type="text" placeholder="Ex.: dobrar salvamentos com carrosséis educativos" /></label>
        <label class="field"><span>Meta de posts</span><input name="posts" type="number" min="0" placeholder="4" /></label>
        <label class="field"><span>Meta de alcance</span><input name="reach" type="number" min="0" placeholder="5000" /></label>
        <label class="field"><span>Meta de seguidores</span><input name="followers" type="number" placeholder="+50" /></label>
        <button title="Começa um ciclo de 10 dias: pesquisa, testes e análise" class="btn primary" type="submit">Criar ciclo</button>
      </form>
    </section>

    @if (error()) { <p class="alert error">{{ error() }}</p> }

    @for (c of cycles(); track c.id) {
      <section class="card cycle" [class.past]="c.report.phase === 'encerrado'">
        <header>
          <div>
            <h2>{{ c.objective || 'Ciclo sem objetivo definido' }}</h2>
            <small class="muted">{{ fmt.dateBR(c.report.current.from) }} a {{ fmt.dateBR(c.report.current.to) }} ·
              @switch (c.report.phase) {
                @case ('futuro') { começa em breve }
                @case ('encerrado') { encerrado }
                @default { dia {{ c.report.day }} de 10 }
              }
            </small>
          </div>
          <button title="Apaga este ciclo e a lista de tarefas dele" type="button" class="btn ghost danger" (click)="remove(c)">Excluir</button>
        </header>

        <div class="timeline" aria-label="Dias do ciclo">
          @for (p of phases; track p.key) {
            @for (d of p.days; track d) {
              <span class="day" [class]="p.key" [class.today]="c.report.day === d" [class.done]="c.report.day > d" [title]="p.label + ' · dia ' + d">{{ d }}</span>
            }
          }
        </div>

        <div class="cols">
          <div>
            <h3>Checklist</h3>
            @for (p of phases; track p.key) {
              <h4 [class.current]="c.report.phase === p.key">{{ p.label }} <small class="muted">{{ p.help }}</small></h4>
              @for (item of c.checklist; track $index; let i = $index) {
                @if (item.phase === p.key) {
                  <label class="check">
                    <input type="checkbox" [checked]="item.done" (change)="toggle(c, i)" />
                    <span [class.striked]="item.done">{{ item.text }}</span>
                  </label>
                }
              }
            }
            <form class="add-item" (submit)="addItem($event, c)">
              <select name="phase">@for (p of phases; track p.key) { <option [value]="p.key">{{ p.label }}</option> }</select>
              <input name="text" type="text" placeholder="Adicionar tarefa" />
              <button title="Acrescenta esta tarefa à lista" class="btn ghost" type="submit">+</button>
            </form>
          </div>

          <div>
            <h3>Resultado</h3>
            <table class="data">
              <thead><tr><th></th><th class="num">Este ciclo</th><th class="num">10 dias antes</th><th class="num">Meta</th></tr></thead>
              <tbody>
                <tr><td>Posts</td><td class="num">{{ c.report.current.posts }}</td><td class="num">{{ c.report.previous.posts }}</td><td class="num" [class.hit]="hit(c.report.current.posts, c.goals.posts)">{{ fmt.num(c.goals.posts) }}</td></tr>
                <tr><td>Alcance</td><td class="num">{{ fmt.num(c.report.current.reach) }} <small>{{ change(c.report.current.reach, c.report.previous.reach) }}</small></td><td class="num">{{ fmt.num(c.report.previous.reach) }}</td><td class="num" [class.hit]="hit(c.report.current.reach, c.goals.reach)">{{ fmt.num(c.goals.reach) }}</td></tr>
                <tr><td>Interações</td><td class="num">{{ fmt.num(c.report.current.interactions) }} <small>{{ change(c.report.current.interactions, c.report.previous.interactions) }}</small></td><td class="num">{{ fmt.num(c.report.previous.interactions) }}</td><td class="num">—</td></tr>
                <tr><td>Seguidores (variação)</td><td class="num">{{ fmt.num(c.report.current.followersDelta) }}</td><td class="num">{{ fmt.num(c.report.previous.followersDelta) }}</td><td class="num" [class.hit]="hit(c.report.current.followersDelta, c.goals.followers)">{{ fmt.num(c.goals.followers) }}</td></tr>
                <tr><td>Score médio</td><td class="num">{{ fmt.dec(c.report.current.avgScore) }}</td><td class="num">{{ fmt.dec(c.report.previous.avgScore) }}</td><td class="num">—</td></tr>
              </tbody>
            </table>
            @if (c.report.current.bestPost; as b) {
              <p class="small">Melhor post do ciclo: <a [href]="b.permalink" target="_blank" rel="noopener">{{ b.formatLabel }} de {{ fmt.dateBR(b.timestamp) }}</a>
                (score {{ fmt.dec(b.score) }}{{ b.hook ? ', gancho ' + b.hook : '' }})</p>
            }
            <label class="field">
              <span>Anotações do ciclo (aprendizados, hipóteses, próximos passos)</span>
              <textarea rows="5" [value]="c.notes" (change)="saveNotes(c, $any($event.target).value)"></textarea>
            </label>
          </div>
        </div>
      </section>
    } @empty {
      <p class="muted">Nenhum ciclo ainda. Crie o primeiro acima.</p>
    }
  `,
  styles: `
    :host { display: grid; gap: 16px; }
    h2 { margin: 0; font-size: 1.05rem; }
    h3 { margin: 0 0 8px; font-size: .95rem; }
    h4 { margin: 12px 0 4px; font-size: .85rem; }
    h4.current { color: var(--accent); }
    h4 small { font-weight: 400; display: block; }
    .small { font-size: .82rem; }
    .new { display: flex; gap: 10px; flex-wrap: wrap; align-items: end; margin-top: 8px; }
    .new .field { width: 150px; }
    .new .grow { flex: 1; min-width: 220px; }
    .cycle { display: grid; gap: 14px; }
    .cycle.past { opacity: .8; }
    header { display: flex; justify-content: space-between; gap: 12px; align-items: start; }
    .timeline { display: grid; grid-template-columns: repeat(10, 1fr); gap: 4px; }
    .day { text-align: center; padding: 6px 0; border-radius: 6px; font-size: .8rem; font-weight: 600; border: 2px solid transparent;
      &.pesquisa { background: color-mix(in srgb, var(--series-1) 18%, transparent); }
      &.testes { background: color-mix(in srgb, var(--series-2) 18%, transparent); }
      &.analise { background: color-mix(in srgb, var(--series-3) 18%, transparent); }
      &.done { opacity: .55; }
      &.today { border-color: var(--text); opacity: 1; } }
    .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
    .check { padding: 3px 0; }
    .striked { text-decoration: line-through; color: var(--muted); }
    .add-item { display: grid; grid-template-columns: 110px 1fr auto; gap: 6px; margin-top: 10px; }
    td.hit { color: var(--ok-text); font-weight: 700; }
    @media (max-width: 800px) { .cols { grid-template-columns: 1fr; } }
  `,
})
export class CyclesPage {
  private api = inject(Api);
  private store = inject(AccountsStore);

  readonly id = input.required<string>();

  protected readonly phases = PHASES;
  protected readonly today = todayIso();
  protected readonly fmt = { dateBR, num, dec };
  protected cycles = signal<Cycle[]>([]);
  protected error = signal('');

  constructor() {
    effect(() => {
      const id = this.id();
      this.store.dataVersion();
      untracked(() => this.load(id));
    });
  }

  private async load(id: string): Promise<void> {
    try {
      this.cycles.set(await this.api.cycles(id));
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  change(cur: number | null, prev: number | null): string {
    const d = delta(cur, prev);
    return d ? `(${d.text})` : '';
  }

  hit(value: number | null, goal: number | undefined): boolean {
    return goal != null && value != null && value >= goal;
  }

  async create(event: Event): Promise<void> {
    event.preventDefault();
    const f = new FormData(event.target as HTMLFormElement);
    const n = (k: string) => (f.get(k) ? Number(f.get(k)) : undefined);
    try {
      const c = await this.api.createCycle(this.id(), {
        startDate: String(f.get('startDate')),
        objective: String(f.get('objective') ?? ''),
        goals: { posts: n('posts'), reach: n('reach'), followers: n('followers') },
      });
      this.cycles.update((list) => [c, ...list]);
      (event.target as HTMLFormElement).reset();
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  private async update(c: Cycle, changes: Partial<Pick<Cycle, 'checklist' | 'notes'>>): Promise<void> {
    try {
      const updated = await this.api.updateCycle(c.id, changes);
      this.cycles.update((list) => list.map((x) => (x.id === c.id ? updated : x)));
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  toggle(c: Cycle, index: number): void {
    this.update(c, { checklist: c.checklist.map((item, i) => (i === index ? { ...item, done: !item.done } : item)) });
  }

  addItem(event: Event, c: Cycle): void {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const f = new FormData(form);
    const text = String(f.get('text') ?? '').trim();
    if (!text) return;
    this.update(c, { checklist: [...c.checklist, { phase: f.get('phase') as Cycle['checklist'][number]['phase'], text, done: false }] });
    form.reset();
  }

  saveNotes(c: Cycle, notes: string): void {
    this.update(c, { notes });
  }

  async remove(c: Cycle): Promise<void> {
    if (!confirm('Excluir este ciclo?')) return;
    await this.api.deleteCycle(c.id);
    this.cycles.update((list) => list.filter((x) => x.id !== c.id));
  }
}
