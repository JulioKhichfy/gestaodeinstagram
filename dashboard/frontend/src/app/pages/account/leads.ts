import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Api, Lead, LeadStats, LeadStatus, LeadsStatus, errorMessage } from '../../core/api';
import { dateTimeBR, num } from '../../core/format';
import { Kpi } from '../../shared/kpi';

type Tab = LeadStatus | 'todos';

const TABS: { value: Tab; label: string; help: string }[] = [
  { value: 'novo', label: 'Novos', help: 'Interessados que ainda não viraram conversa (os sem resposta e urgentes vêm primeiro)' },
  { value: 'em_conversa', label: 'Em conversa', help: 'Você já respondeu; acompanhe até fechar' },
  { value: 'cliente', label: 'Clientes', help: 'Viraram clientes: registre o valor para medir o retorno do Instagram' },
  { value: 'descartado', label: 'Descartados', help: 'Não eram clientes (curiosos, spam, fora do perfil)' },
  { value: 'todos', label: 'Todos os comentários', help: 'Todos os comentários lidos, inclusive elogios e spam' },
];

const STATUS_LABELS: Record<LeadStatus, string> = { novo: 'Novo', em_conversa: 'Em conversa', cliente: 'Cliente', descartado: 'Descartado' };

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Captar clientes: comentários dos posts de quem quer comprar ou contratar. O Jev separa os interessados,
 * o Claude sugere a resposta e você responde com um clique. Nada sai sem você.
 */
@Component({
  selector: 'app-leads',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Kpi],
  template: `
    <section class="card">
      <div class="head">
        <div>
          <h2>Captar clientes</h2>
          <p class="muted small">O dashboard lê os comentários dos seus posts dos últimos 60 dias, separa quem quer comprar ou
            contratar (regra de palavras + Jev) e ajuda a responder rápido. Nada é enviado sem você clicar.</p>
        </div>
        <button type="button" class="btn primary" [disabled]="refreshing() || !canRefresh()" (click)="refresh()"
                title="Lê agora os comentários novos e classifica (também roda sozinho a cada 6 h)">
          @if (refreshing()) { <span class="spinner"></span> Buscando… } @else { Buscar comentários agora }
        </button>
      </div>

      @if (status(); as s) {
        @if (!s.connected) {
          <p class="alert warn">Conecte a conta na página dela para ler os comentários.</p>
        } @else if (!s.hasPermission) {
          <p class="alert warn"><strong>Falta uma permissão.</strong> Para ler e responder comentários, reconecte a conta
            ({{ s.via === 'facebook' ? '"Conectar pelo Facebook"' : '"Reconectar"' }} na página da conta) e aceite a permissão de comentários.</p>
        }
        @if (!s.jev) { <p class="muted small">Jev desligado: a separação usa só a regra de palavras ("quanto custa", "orçamento"…).</p> }
      }
      @if (message()) { <p class="alert info">{{ message() }}</p> }
      @if (error()) { <p class="alert error">{{ error() }}</p> }

      @if (stats(); as st) {
        <div class="kpis">
          <app-kpi label="Interessados (30 dias)" [value]="fmt.num(st.leads)" [hint]="'de ' + fmt.num(st.comments) + ' comentários'" />
          <app-kpi label="Sem resposta" [value]="fmt.num(st.pending)" hint="Responder rápido aumenta a chance de fechar" />
          <app-kpi label="Em conversa" [value]="fmt.num(st.emConversa)" />
          <app-kpi label="Clientes" [value]="fmt.num(st.clientes)" [hint]="st.conversao === null ? '' : st.conversao + '% dos interessados'" />
          <app-kpi label="Valor fechado" [value]="money(st.valor)" hint="Soma do valor registrado nos clientes" />
        </div>
      }
    </section>

    <section class="card">
      <div class="tabs" role="tablist">
        @for (t of tabs; track t.value) {
          <button type="button" role="tab" [attr.aria-selected]="tab() === t.value" [class.active]="tab() === t.value"
                  [title]="t.help" (click)="tab.set(t.value)">{{ t.label }}</button>
        }
      </div>

      @for (l of leads(); track l.id) {
        <article class="lead" [class.urgent]="(l.urgent ?? 0) >= 0.5 && l.status === 'novo'">
          @if (l.media.thumbnail) { <img class="post" [src]="l.media.thumbnail" alt="" loading="lazy" /> }
          <div class="body">
            <div class="line">
              <span>
                @if (l.username) {
                  <a [href]="'https://www.instagram.com/' + l.username" target="_blank" rel="noopener" title="Abrir o perfil no Instagram">&#64;{{ l.username }}</a>
                } @else { <strong>Alguém</strong> }
                <small class="muted"> · {{ when(l.timestamp) }}</small>
              </span>
              <span class="chips">
                @if (l.intentLabel) { <span class="chip" title="Intenção identificada pelo Jev">{{ l.intentLabel }}</span> }
                @if (l.interest !== null) { <span class="chip" title="Probabilidade de querer comprar ou contratar">Interesse {{ pct(l.interest) }}</span> }
                @if ((l.urgent ?? 0) >= 0.5) { <span class="chip warn" title="Pede resposta rápida ou cita data próxima">⏰ Urgente</span> }
                @if (l.repliedAt) { <span class="chip ok" [title]="'Resposta: ' + (l.replyText ?? '')">✓ Respondido</span> }
              </span>
            </div>
            <p class="text">“{{ l.text }}”</p>
            @if (l.media.caption) {
              <small class="muted">no post: {{ l.media.caption }}@if (l.media.permalink) { · <a [href]="l.media.permalink" target="_blank" rel="noopener" title="Abrir o post no Instagram">ver post ↗</a> }</small>
            }

            @if (replyFor() === l.id) {
              <div class="reply">
                <textarea rows="3" [value]="draft()" (input)="draft.set($any($event.target).value)" aria-label="Resposta ao comentário"
                          placeholder="Escreva a resposta ou peça uma sugestão ao Claude"></textarea>
                <div class="line">
                  <small class="muted">{{ draft().length }} caracteres · aparece como resposta pública ao comentário</small>
                  <span class="actions">
                    <button type="button" class="btn ghost" [disabled]="busy()" (click)="suggest(l)" title="O Claude escreve uma resposta curta no tom da conta (você edita antes de enviar)">
                      @if (busy() === 'suggest') { <span class="spinner"></span> } Sugerir com o Claude
                    </button>
                    <button type="button" class="btn ghost" (click)="replyFor.set(null)" title="Fecha sem responder">Cancelar</button>
                    <button type="button" class="btn primary" [disabled]="busy() || !draft().trim()" (click)="send(l)" title="Publica esta resposta no comentário, no Instagram">
                      @if (busy() === 'send') { <span class="spinner"></span> } Responder no Instagram
                    </button>
                  </span>
                </div>
              </div>
            } @else {
              <div class="line">
                <span class="actions">
                  <button type="button" class="btn primary" [disabled]="!canRefresh()" (click)="openReply(l)" title="Escrever (ou pedir ao Claude) uma resposta pública ao comentário">Responder</button>
                  @if (l.username) {
                    <a class="btn ghost" [href]="'https://ig.me/m/' + l.username" target="_blank" rel="noopener"
                       title="Abre o direct com esta pessoa no Instagram (a mensagem é escrita e enviada por você)">Abrir direct ↗</a>
                  }
                </span>
                <span class="actions">
                  <select [value]="l.status" (change)="setStatus(l, $any($event.target).value)" aria-label="Status" title="Em que etapa está este cliente em potencial">
                    @for (s of statuses; track s) { <option [value]="s">{{ statusLabels[s] }}</option> }
                  </select>
                  @if (l.status === 'cliente') {
                    <input class="value" type="number" min="0" step="0.01" [value]="l.dealValue ?? ''" placeholder="Valor R$"
                           (change)="setValue(l, $any($event.target).value)" title="Valor fechado com este cliente (para medir o retorno)" />
                  }
                </span>
              </div>
            }
            <details>
              <summary title="Anotações só suas (contato, o que foi combinado)">Anotações{{ l.notes ? ' ✎' : '' }}</summary>
              <textarea rows="2" [value]="l.notes" (change)="setNotes(l, $any($event.target).value)" aria-label="Anotações"></textarea>
            </details>
          </div>
        </article>
      } @empty {
        <p class="muted">{{ loading() ? 'Carregando…' : emptyText() }}</p>
      }
    </section>

    @if (stats()?.topPosts?.length) {
      <section class="card">
        <h3>Posts que mais trazem interessados (30 dias)</h3>
        <table class="data">
          <thead><tr><th>Post</th><th class="num">Interessados</th><th class="num">Clientes</th></tr></thead>
          <tbody>
            @for (p of stats()!.topPosts; track p.mediaId) {
              <tr>
                <td>@if (p.permalink) { <a [href]="p.permalink" target="_blank" rel="noopener">{{ p.caption || 'post' }}</a> } @else { {{ p.caption }} }</td>
                <td class="num">{{ p.leads }}</td><td class="num">{{ p.clients }}</td>
              </tr>
            }
          </tbody>
        </table>
        <p class="muted small">Faça mais posts parecidos com os que trazem clientes, e considere impulsioná-los (aba Tráfego pago).</p>
      </section>
    }
  `,
  styles: `
    :host { display: grid; gap: 16px; }
    h2 { margin: 0 0 4px; font-size: 1.1rem; }
    h3 { margin: 0 0 8px; font-size: 1rem; }
    .small { font-size: .85rem; margin: 0; }
    .head { display: flex; justify-content: space-between; gap: 12px; align-items: start; flex-wrap: wrap; }
    .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-top: 12px; }
    .tabs { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px;
      button { border: 1px solid var(--border); background: var(--surface); border-radius: 999px; padding: 6px 12px; cursor: pointer; font: inherit; color: inherit; }
      button.active { background: var(--accent); color: #fff; border-color: var(--accent); } }
    .lead { display: grid; grid-template-columns: 56px 1fr; gap: 12px; padding: 12px 0; border-top: 1px solid var(--border);
      &.urgent { box-shadow: inset 3px 0 0 var(--warn-text); padding-left: 8px; } }
    .post { width: 56px; height: 70px; object-fit: cover; border-radius: 6px; }
    .body { display: grid; gap: 6px; min-width: 0; }
    .line { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; }
    .chips { display: flex; gap: 6px; flex-wrap: wrap; }
    .chip { font-size: .75rem; border: 1px solid var(--border); border-radius: 999px; padding: 2px 8px;
      &.warn { background: var(--warn-bg); color: var(--warn-text); border-color: transparent; }
      &.ok { background: var(--ok-bg); color: var(--ok-text); border-color: transparent; } }
    .text { margin: 0; white-space: pre-wrap; }
    .actions { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
    .value { width: 110px; }
    .reply { display: grid; gap: 6px; }
    details summary { cursor: pointer; color: var(--muted); font-size: .85rem; }
    @media (max-width: 600px) { .lead { grid-template-columns: 1fr; } .post { display: none; } }
  `,
})
export class LeadsPage {
  private api = inject(Api);

  readonly id = input.required<string>();

  protected readonly tabs = TABS;
  protected readonly statuses = Object.keys(STATUS_LABELS) as LeadStatus[];
  protected readonly statusLabels = STATUS_LABELS;
  protected readonly fmt = { num };
  protected readonly when = dateTimeBR;
  protected pct = (v: number) => `${Math.round(v * 100)}%`;
  protected money = (v: number) => money.format(v);

  protected tab = signal<Tab>('novo');
  protected status = signal<LeadsStatus | null>(null);
  protected stats = signal<LeadStats | null>(null);
  protected leads = signal<Lead[]>([]);
  protected loading = signal(false);
  protected refreshing = signal(false);
  protected error = signal('');
  protected message = signal('');
  protected replyFor = signal<string | null>(null);
  protected draft = signal('');
  protected busy = signal<'suggest' | 'send' | null>(null);

  protected canRefresh = computed(() => !!this.status()?.connected && !!this.status()?.hasPermission);
  protected emptyText = computed(() =>
    this.tab() === 'novo'
      ? 'Nenhum interessado novo. Clique em "Buscar comentários agora" depois de publicar ou quando chegarem comentários.'
      : 'Nada aqui por enquanto.',
  );

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => this.loadHeader(id));
    });
    effect(() => {
      const id = this.id();
      const tab = this.tab();
      untracked(() => this.loadLeads(id, tab));
    });
  }

  private async loadHeader(id: string): Promise<void> {
    try {
      const [status, stats] = await Promise.all([this.api.leadsStatus(id), this.api.leadStats(id, 30)]);
      this.status.set(status);
      this.stats.set(stats);
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  private async loadLeads(id: string, tab: Tab): Promise<void> {
    this.loading.set(true);
    try {
      this.leads.set(await this.api.leads(id, tab));
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  async refresh(): Promise<void> {
    this.refreshing.set(true);
    this.error.set('');
    this.message.set('');
    try {
      const r = await this.api.refreshLeads(this.id());
      this.message.set(
        `${r.fetched} comentário(s) lido(s) em ${r.posts} post(s), ${r.added} novo(s); ${r.classified} classificado(s).` +
          (r.failed ? ` ${r.failed} falharam na classificação; tente de novo.` : ''),
      );
      await Promise.all([this.loadHeader(this.id()), this.loadLeads(this.id(), this.tab())]);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.refreshing.set(false);
    }
  }

  openReply(l: Lead): void {
    this.replyFor.set(l.id);
    this.draft.set('');
    this.error.set('');
  }

  async suggest(l: Lead): Promise<void> {
    this.busy.set('suggest');
    this.error.set('');
    try {
      this.draft.set((await this.api.suggestReply(l.id)).text);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(null);
    }
  }

  async send(l: Lead): Promise<void> {
    if (!confirm(`Publicar esta resposta no comentário de @${l.username ?? 'alguém'}?`)) return;
    this.busy.set('send');
    this.error.set('');
    try {
      const updated = await this.api.replyLead(l.id, this.draft().trim());
      this.replace(updated);
      this.replyFor.set(null);
      this.message.set('Resposta publicada. O interessado foi para "Em conversa".');
      this.loadHeader(this.id());
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(null);
    }
  }

  async setStatus(l: Lead, status: LeadStatus): Promise<void> {
    await this.patch(l, { status });
    if (this.tab() !== 'todos' && status !== this.tab()) this.leads.update((list) => list.filter((x) => x.id !== l.id));
    this.loadHeader(this.id());
  }

  setValue(l: Lead, value: string): Promise<void> {
    return this.patch(l, { dealValue: value === '' ? null : Number(value) }).then(() => this.loadHeader(this.id()));
  }

  setNotes(l: Lead, notes: string): Promise<void> {
    return this.patch(l, { notes });
  }

  private async patch(l: Lead, body: Parameters<Api['updateLead']>[1]): Promise<void> {
    try {
      this.replace(await this.api.updateLead(l.id, body));
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  private replace(updated: Lead): void {
    this.leads.update((list) => list.map((x) => (x.id === updated.id ? updated : x)));
  }
}
