import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AccountsStore } from '../../core/accounts';
import { AdPlan, Api, BoostData, Post, errorMessage } from '../../core/api';
import { dateBR, dec, num } from '../../core/format';
import { ClaudePanel } from '../../shared/claude-panel';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

@Component({
  selector: 'app-ads',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ClaudePanel, RouterLink],
  template: `
    @if (error()) { <p class="alert error">{{ error() }}</p> }

    @if (data(); as d) {
      <section class="card reco">
        <h2>Recomendação para esta conta</h2>
        <dl>
          <dt>Objetivo</dt><dd>{{ d.recommendation.objective }}</dd>
          <dt>Público</dt><dd>{{ d.recommendation.audience }}</dd>
          <dt>Orçamento de teste</dt><dd>{{ d.recommendation.budget }}</dd>
          <dt>Dica</dt><dd>{{ d.recommendation.tip }}</dd>
        </dl>
        <p class="muted small">O dashboard planeja e acompanha; o impulsionamento em si é feito no app (botão “Turbinar” no post)
          ou no <a href="https://adsmanager.facebook.com/" target="_blank" rel="noopener">Gerenciador de Anúncios</a>.
          Guia completo em <a routerLink="/ajuda" fragment="trafego">Ajuda › Tráfego pago</a>.</p>
      </section>

      <section class="card">
        <h2>Posts com potencial para impulsionar</h2>
        <p class="muted small">Últimos 45 dias, com score acima da mediana da conta. Impulsionar o que já funciona no orgânico costuma
          custar menos por resultado do que impulsionar um post fraco.</p>
        <div class="candidates">
          @for (c of d.candidates; track c.post.id) {
            <article class="cand" [class.selected]="selected()?.id === c.post.id">
              @if (c.post.thumbnail) { <img [src]="c.post.thumbnail" alt="" loading="lazy" /> }
              <div class="body">
                <strong>{{ c.post.formatLabel }} · {{ fmt.dateBR(c.post.timestamp) }}</strong>
                <small class="muted">Score {{ fmt.dec(c.post.score) }} · alcance {{ fmt.num(c.post.reach) }} · {{ fmt.num(c.post.shares) }} compart. · {{ fmt.num(c.post.saved) }} salv.</small>
                <ul>@for (r of c.reasons; track r) { <li>{{ r }}</li> }</ul>
                <div class="actions">
                  <button title="Monta um plano de impulsionamento para este post" type="button" class="btn primary" (click)="plan(c.post)">Planejar</button>
                  <a class="btn ghost" [href]="c.post.permalink" target="_blank" rel="noopener">Abrir para Turbinar ↗</a>
                </div>
              </div>
            </article>
          } @empty {
            <p class="muted">Ainda não há posts com métricas suficientes. Sincronize a conta e volte depois de alguns posts.</p>
          }
        </div>
      </section>

      <section class="card" id="planner">
        <h2>Planejar impulsionamento</h2>
        @if (selected(); as p) {
          <p class="small">Post: <a [href]="p.permalink" target="_blank" rel="noopener">{{ p.formatLabel }} de {{ fmt.dateBR(p.timestamp) }}</a>
            <button type="button" class="link-btn" (click)="selected.set(null)">remover</button></p>
        } @else {
          <p class="muted small">Escolha um post acima ou planeje uma campanha geral.</p>
        }
        <form class="planner" (submit)="savePlan($event)">
          <label class="field"><span>Objetivo</span>
            <input name="objective" type="text" [value]="d.recommendation.objective" required /></label>
          <label class="field"><span>Orçamento diário (R$)</span>
            <input name="dailyBudget" type="number" min="1" step="1" [value]="budget()" (input)="budget.set(+$any($event.target).value)" required /></label>
          <label class="field"><span>Dias</span>
            <input name="days" type="number" min="1" max="60" [value]="days()" (input)="days.set(+$any($event.target).value)" required /></label>
          <label class="field wide"><span>Público</span>
            <textarea name="audience" rows="2">{{ d.recommendation.audience }}</textarea></label>
          <label class="field wide"><span>Anotações</span><textarea name="notes" rows="2" placeholder="Hipótese, criativo, link de destino…"></textarea></label>
          <div class="total wide">
            Investimento total previsto: <strong>{{ total() }}</strong>
            <button title="Guarda o plano para comparar o resultado depois" class="btn primary" type="submit">Salvar plano</button>
          </div>
        </form>

        <app-claude-panel [accountId]="id()" [artifacts]="['trafego', 'livre']" [currentText]="selectedText()" />
      </section>

      <section class="card">
        <h2>Campanhas planejadas e resultados</h2>
        <div class="table-scroll">
          <table class="data">
            <thead><tr><th>Criado</th><th>Objetivo</th><th class="num">Previsto</th><th>Status</th><th class="num">Gasto (R$)</th><th class="num">Alcance</th><th class="num">Resultados</th><th class="num">Custo/resultado</th><th></th></tr></thead>
            <tbody>
              @for (p of d.plans; track p.id) {
                <tr>
                  <td>{{ fmt.dateBR(p.created_at) }}</td>
                  <td>{{ p.objective }}<br /><small class="muted">{{ p.days }} dias × {{ brl(p.daily_budget) }}</small></td>
                  <td class="num">{{ brl(p.daily_budget * p.days) }}</td>
                  <td>
                    <select [value]="p.status" (change)="update(p, { status: $any($event.target).value })">
                      <option value="planejado">Planejado</option><option value="rodando">Rodando</option><option value="concluido">Concluído</option>
                    </select>
                  </td>
                  <td class="num"><input class="mini" type="number" min="0" step="0.01" [value]="p.spent ?? ''" (change)="update(p, { spent: numOrNull($any($event.target).value) })" /></td>
                  <td class="num"><input class="mini" type="number" min="0" [value]="p.result_reach ?? ''" (change)="update(p, { resultReach: numOrNull($any($event.target).value) })" /></td>
                  <td class="num"><input class="mini" type="number" min="0" [value]="p.result_actions ?? ''" (change)="update(p, { resultActions: numOrNull($any($event.target).value) })" title="Mensagens, cliques, vendas… o que o objetivo mede" /></td>
                  <td class="num">{{ costPer(p) }}</td>
                  <td><button title="Apaga este plano" type="button" class="link-btn" (click)="remove(p)">excluir</button></td>
                </tr>
              } @empty { <tr><td colspan="9" class="muted">Nenhum plano ainda.</td></tr> }
            </tbody>
          </table>
        </div>
        <p class="muted small">Preencha o gasto e os resultados quando a campanha terminar (o app mostra em “Ver insights” do anúncio).
          O custo por resultado ajuda a decidir onde investir de novo.</p>
      </section>
    }
  `,
  styles: `
    :host { display: grid; gap: 16px; }
    h2 { margin: 0 0 10px; font-size: 1.05rem; }
    .small { font-size: .82rem; }
    dl { display: grid; grid-template-columns: 160px 1fr; gap: 6px 12px; margin: 0 0 10px; }
    dt { font-weight: 600; color: var(--muted); }
    dd { margin: 0; }
    .candidates { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
    .cand { display: flex; gap: 10px; border: 1px solid var(--border); border-radius: 10px; padding: 10px;
      &.selected { border-color: var(--accent); }
      img { width: 72px; height: 90px; object-fit: cover; border-radius: 6px; flex: none; }
      .body { display: grid; gap: 4px; min-width: 0; }
      ul { margin: 0; padding-left: 18px; font-size: .82rem; }
      .actions { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px; } }
    .planner { display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 10px; margin-bottom: 12px; }
    .wide { grid-column: 1 / -1; }
    .total { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
    .mini { width: 90px; padding: 4px 6px !important; text-align: right; }
    @media (max-width: 700px) { .planner { grid-template-columns: 1fr; } dl { grid-template-columns: 1fr; } }
  `,
})
export class AdsPage {
  private api = inject(Api);
  private store = inject(AccountsStore);

  readonly id = input.required<string>();

  protected readonly fmt = { dateBR, dec, num };
  protected data = signal<BoostData | null>(null);
  protected selected = signal<Post | null>(null);
  protected budget = signal(20);
  protected days = signal(7);
  protected error = signal('');

  protected total = computed(() => brl.format((this.budget() || 0) * (this.days() || 0)));
  protected selectedText = computed(() => {
    const p = this.selected();
    return p ? `Post (${p.formatLabel}, score ${dec(p.score)}, alcance ${num(p.reach)}): ${p.caption}` : '';
  });

  constructor() {
    effect(() => {
      const id = this.id();
      this.store.dataVersion();
      untracked(() => {
        this.selected.set(null);
        this.load(id);
      });
    });
  }

  private async load(id: string): Promise<void> {
    try {
      this.data.set(await this.api.boost(id));
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  brl(v: number | null): string {
    return v == null ? '—' : brl.format(v);
  }

  numOrNull(v: string): number | null {
    return v === '' ? null : Number(v);
  }

  costPer(p: AdPlan): string {
    return p.spent != null && p.result_actions ? brl.format(p.spent / p.result_actions) : '—';
  }

  plan(post: Post): void {
    this.selected.set(post);
    document.getElementById('planner')?.scrollIntoView({ behavior: 'smooth' });
  }

  async savePlan(event: Event): Promise<void> {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const f = new FormData(form);
    try {
      const plan = await this.api.createAdPlan(this.id(), {
        mediaId: this.selected()?.id ?? null,
        objective: String(f.get('objective')),
        dailyBudget: Number(f.get('dailyBudget')),
        days: Number(f.get('days')),
        audience: String(f.get('audience') ?? ''),
        notes: String(f.get('notes') ?? ''),
      });
      this.data.update((d) => (d ? { ...d, plans: [plan, ...d.plans] } : d));
      this.selected.set(null);
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  async update(p: AdPlan, changes: Parameters<Api['updateAdPlan']>[1]): Promise<void> {
    try {
      const updated = await this.api.updateAdPlan(p.id, changes);
      this.data.update((d) => (d ? { ...d, plans: d.plans.map((x) => (x.id === p.id ? updated : x)) } : d));
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  async remove(p: AdPlan): Promise<void> {
    if (!confirm('Excluir este plano?')) return;
    await this.api.deleteAdPlan(p.id);
    this.data.update((d) => (d ? { ...d, plans: d.plans.filter((x) => x.id !== p.id) } : d));
  }
}
