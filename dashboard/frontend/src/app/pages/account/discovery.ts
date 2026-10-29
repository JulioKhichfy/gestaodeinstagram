import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AccountsStore } from '../../core/accounts';
import {
  Api,
  DiscoveredProfile,
  DiscoverySearch,
  DiscoverySuggestions,
  FacebookStatus,
  HashtagUsage,
  errorMessage,
} from '../../core/api';
import { DEFAULT_FILTER, FOLLOWER_RANGES, ProfileFilter, filterProfiles, normalizeTerm } from '../../core/discovery';
import { dateBR, dateTimeBR, num } from '../../core/format';
import { ProfileCard } from './profile-card';

type Tab = 'resultados' | 'sugestoes' | 'salvos';

/**
 * Descoberta de perfis com o que a API oficial permite: busca por hashtag (posts + @menções),
 * Business Discovery (dados públicos de contas profissionais) e sugestões por afinidade.
 */
@Component({
  selector: 'app-discovery',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ProfileCard, RouterLink],
  template: `
    @if (banner(); as b) {
      <p class="alert" [class.ok]="b.ok" [class.error]="!b.ok">{{ b.text }}
        <button type="button" class="link-btn" (click)="banner.set(null)" aria-label="Fechar">✕</button></p>
    }

    <section class="card fb">
      @if (fbStatus(); as f) {
        @if (f.missing.length) {
          <p class="alert warn">A Descoberta usa o <strong>login do Facebook</strong> (exigência da Meta para busca por hashtag e dados
            de outros perfis). Configure no <code>backend/.env</code>: {{ f.missing.join(', ') }} e cadastre o retorno
            <code>{{ f.redirectUri }}</code>. Passo a passo em <a routerLink="/ajuda" fragment="descoberta">Ajuda › Descoberta</a>.
            Sem isso, as sugestões usam só as menções dos seus próprios posts.</p>
        } @else if (!f.connected) {
          <div class="row">
            <p>Conecte o <strong>Facebook</strong> que administra as Páginas vinculadas às suas contas do Instagram para buscar
              por hashtag e ver dados públicos de outros perfis.</p>
            <button title="Login do Facebook: libera a busca de perfis e hashtags" type="button" class="btn primary" [disabled]="busy()" (click)="connectFacebook()">Conectar Facebook</button>
          </div>
        } @else {
          <div class="row">
            <p class="small">Facebook conectado{{ f.name ? ' como ' + f.name : '' }} · válido até {{ fmt.dateBR(f.expiresAt) }}.
              @if (linkedHere()) { Esta conta faz as próprias consultas. }
              @else if (via()) { Esta conta não está vinculada a uma Página; as consultas saem por &#64;{{ viaUsername() }}. }
              @else { Nenhuma das suas contas apareceu vinculada a uma Página do Facebook. }
            </p>
            <span class="buttons">
              <button title="Refaz o login do Facebook (acesso vence em ~60 dias)" type="button" class="btn ghost" [disabled]="busy()" (click)="connectFacebook()">Reconectar</button>
              <button title="Remove o acesso do Facebook (as contas conectadas por ele também saem)" type="button" class="btn ghost danger" (click)="disconnectFacebook()">Desconectar</button>
            </span>
          </div>
          @if (f.missingPermissions.length) {
            <p class="alert warn small">Permissões não concedidas: {{ f.missingPermissions.join(', ') }}. Reconecte e marque todas.</p>
          }
        }
      }

      @if (usage(); as u) {
        <div class="usage" [class.full]="u.remaining === 0">
          <span>Hashtags consultadas nos últimos 7 dias: <strong>{{ u.used }} de {{ u.limit }}</strong></span>
          <meter min="0" [max]="u.limit" [value]="u.used" [attr.aria-label]="u.used + ' de ' + u.limit + ' hashtags'"></meter>
          @if (u.hashtags.length) {
            <span class="tags">
              @for (h of u.hashtags; track h.hashtag) {
                <button type="button" class="chip" [title]="'Libera em ' + fmt.dateTimeBR(h.freesAt)" (click)="search(h.hashtag)">#{{ h.hashtag }}</button>
              }
            </span>
          }
        </div>
      }
    </section>

    <form class="search card" (submit)="submit($event)">
      <label class="field grow"><span>Buscar por palavra-chave</span>
        <input type="search" name="q" [value]="term()" (input)="term.set($any($event.target).value)"
          placeholder="Ex.: decoração afetiva, arquitetura de consultório" /></label>
      <button title="Busca posts recentes e em alta desta hashtag (conta no limite de 30 por semana)" class="btn primary" type="submit" [disabled]="!canSearch() || searching()">
        {{ searching() ? 'Buscando…' : 'Buscar' }}</button>
      <small class="muted hint">
        @if (normalized()) { Vai consultar <strong>#{{ normalized() }}</strong>. }
        @if (blocked()) { Limite de 30 hashtags atingido: só dá para repetir hashtags já consultadas na semana. }
        @else { Resultados ficam em cache por 24h; repetir a busca não gasta o limite. }
      </small>
    </form>

    <div class="toolbar">
      <div class="segmented" role="tablist" aria-label="Listas">
        <button title="Perfis encontrados na última busca" type="button" role="tab" [attr.aria-selected]="tab() === 'resultados'" [class.active]="tab() === 'resultados'" (click)="tab.set('resultados')">Resultados</button>
        <button title="Perfis parecidos com a sua conta, pelas hashtags e menções dos seus melhores posts" type="button" role="tab" [attr.aria-selected]="tab() === 'sugestoes'" [class.active]="tab() === 'sugestoes'" (click)="openSuggestions()">Sugestões</button>
        <button title="Perfis que você salvou ou marcou como referência" type="button" role="tab" [attr.aria-selected]="tab() === 'salvos'" [class.active]="tab() === 'salvos'" (click)="openSaved()">Lista salva ({{ saved().length }})</button>
      </div>
      <label class="field inline"><span>Seguidores</span>
        <select (change)="patchFilter({ followers: $any($event.target).value })">
          @for (r of ranges; track r.key) { <option [value]="r.key" [selected]="filter().followers === r.key">{{ r.label }}</option> }
        </select></label>
      <label class="field inline"><span>Posts/semana</span>
        <select (change)="patchFilter({ minPostsPerWeek: +$any($event.target).value })">
          <option value="0">Qualquer</option><option value="1">1 ou mais</option><option value="3">3 ou mais</option>
        </select></label>
      <label class="field inline"><span>Engajamento</span>
        <select (change)="patchFilter({ minEngagement: +$any($event.target).value })">
          <option value="0">Qualquer</option><option value="1">1% ou mais</option><option value="3">3% ou mais</option>
        </select></label>
      <label class="check small"><input type="checkbox" [checked]="filter().hideUnavailable"
        (change)="patchFilter({ hideUnavailable: $any($event.target).checked })" /> Ocultar indisponíveis</label>
    </div>

    @if (error()) { <p class="alert error">{{ error() }}</p> }

    @switch (tab()) {
      @case ('resultados') {
        @if (result(); as r) {
          <p class="muted small">#{{ r.hashtag }} · {{ r.posts.length }} posts ({{ r.cached ? 'do cache de ' : 'consultados em ' }}{{ fmt.dateTimeBR(r.fetchedAt) }}).
            A Meta não informa o autor dos posts de hashtag; os perfis abaixo são os <strong>&#64;mencionados</strong> nas legendas.
            Abra os posts para ver quem publicou.</p>
          <h2>Perfis mencionados</h2>
          <div class="cards">
            @for (p of shown(r.profiles); track p.id) { <app-profile-card [profile]="p" (changed)="replace($event)" /> }
            @empty { <p class="muted">Nenhum &#64;perfil mencionado nesses posts (ou nenhum passa nos filtros).</p> }
          </div>
          <h2>Posts da hashtag</h2>
          <div class="table-scroll">
            <table class="data">
              <thead><tr><th>Lista</th><th>Data</th><th>Legenda</th><th class="num">Curtidas</th><th class="num">Coment.</th><th></th></tr></thead>
              <tbody>
                @for (m of r.posts; track m.edge + m.id) {
                  <tr>
                    <td>{{ m.edge === 'top' ? 'Em alta' : 'Recente' }}</td>
                    <td>{{ fmt.dateBR(m.timestamp) }}</td>
                    <td class="cap">{{ m.caption || '—' }}</td>
                    <td class="num">{{ fmt.num(m.likes) }}</td>
                    <td class="num">{{ fmt.num(m.comments) }}</td>
                    <td><a [href]="m.permalink" target="_blank" rel="noopener">abrir ↗</a></td>
                  </tr>
                } @empty { <tr><td colspan="6" class="muted">A Meta não retornou posts públicos para esta hashtag.</td></tr> }
              </tbody>
            </table>
          </div>
        } @else {
          <p class="muted">Digite um tema acima. O dashboard transforma o termo em hashtag, lista os posts em alta e recentes
            (últimas 24h) e os perfis mencionados neles, com dados públicos e o motivo da sugestão.</p>
        }
      }
      @case ('sugestoes') {
        @if (loadingSuggestions()) { <p class="muted">Calculando sugestões…</p> }
        @if (suggested(); as s) {
          @if (s.ownHashtags.length) {
            <p class="small"><span class="muted">Suas hashtags de melhor desempenho (clique para buscar):</span>
              @for (h of s.ownHashtags; track h.hashtag) {
                <button title="Buscar de novo esta hashtag (não gasta o limite semanal)" type="button" class="chip" (click)="search(h.hashtag)">#{{ h.hashtag }}</button>
              }
            </p>
          }
          @if (s.pendingLookups) {
            <p class="muted small">Faltam {{ s.pendingLookups }} perfis para consultar (o dashboard consulta 15 por vez para respeitar o limite da Meta).
              <button title="Consulta mais perfis na Meta" type="button" class="link-btn" (click)="openSuggestions(true)">Consultar mais</button></p>
          }
          <div class="cards">
            @for (p of shown(s.profiles); track p.id) { <app-profile-card [profile]="p" (changed)="replace($event)" /> }
            @empty { <p class="muted">Sem sugestões ainda. Elas vêm dos &#64;perfis que você menciona nos seus posts, das buscas por
              hashtag e dos concorrentes cadastrados na Lista salva.</p> }
          </div>
        }
      }
      @case ('salvos') {
        <form class="watch" (submit)="addWatch($event)">
          <label class="field grow"><span>Cadastrar concorrente ou referência</span>
            <input name="username" type="text" placeholder="&#64;perfil ou link do Instagram" required /></label>
          <button title="Acompanha este perfil como referência ou concorrente" class="btn primary" type="submit">Adicionar</button>
        </form>
        <div class="cards">
          @for (p of shown(saved()); track p.id) { <app-profile-card [profile]="p" (changed)="replace($event)" /> }
          @empty { <p class="muted">Nada salvo ainda. Marque perfis como “Salvo” ou “Em contato”, ou cadastre concorrentes acima.</p> }
        </div>
      }
    }

    <p class="muted small">Business Discovery só mostra contas profissionais (Empresa ou Criador); a Meta não informa qual das duas.
      Nada é enviado aos perfis: seguir, mandar mensagem ou propor parceria é sempre manual, no Instagram.</p>
  `,
  styles: `
    :host { display: grid; gap: 16px; }
    h2 { margin: 8px 0 0; font-size: 1rem; }
    p { margin: 0; }
    .fb { display: grid; gap: 10px; }
    .row { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
    .buttons { display: flex; gap: 8px; }
    .usage { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: .88rem;
      meter { width: 160px; } &.full strong { color: var(--error-text); } }
    .tags { display: flex; gap: 4px; flex-wrap: wrap; }
    .search, .watch { display: flex; gap: 10px; align-items: end; flex-wrap: wrap; }
    .grow { flex: 1; min-width: 220px; }
    .hint { flex-basis: 100%; }
    .field.inline { display: flex; align-items: center; gap: 6px; font-size: .85rem; select { width: auto; } }
    .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr)); gap: 12px; }
    .cap { max-width: 520px; white-space: pre-line; }
    .chip { margin: 2px; }
  `,
})
export class DiscoveryPage {
  private api = inject(Api);
  private store = inject(AccountsStore);
  private router = inject(Router);

  readonly id = input.required<string>();
  /** Volta do login do Facebook (query params). */
  readonly fb = input<string>();
  readonly fbError = input<string>();

  protected readonly fmt = { dateBR, dateTimeBR, num };
  protected readonly ranges = FOLLOWER_RANGES;

  protected fbStatus = signal<FacebookStatus | null>(null);
  protected usage = signal<HashtagUsage | null>(null);
  protected via = signal<string | null>(null);
  protected tab = signal<Tab>('resultados');
  protected term = signal('');
  protected result = signal<DiscoverySearch | null>(null);
  protected suggested = signal<DiscoverySuggestions | null>(null);
  protected saved = signal<DiscoveredProfile[]>([]);
  protected filter = signal<ProfileFilter>(DEFAULT_FILTER);
  protected searching = signal(false);
  protected loadingSuggestions = signal(false);
  protected busy = signal(false);
  protected error = signal('');
  protected banner = signal<{ ok: boolean; text: string } | null>(null);

  protected normalized = computed(() => normalizeTerm(this.term()));
  protected blocked = computed(() => {
    const u = this.usage();
    return Boolean(u && u.remaining === 0 && !u.hashtags.some((h) => h.hashtag === this.normalized()));
  });
  protected canSearch = computed(() => /[a-z]/.test(this.normalized()) && !this.blocked());
  protected linkedHere = computed(() => this.fbStatus()?.linked.find((l) => l.accountId === this.id())?.linked ?? false);
  protected viaUsername = computed(() => this.store.byId(this.via() ?? '')?.username ?? '');

  constructor() {
    // Facebook, contador e lista salva: recarrega ao trocar de conta.
    effect(() => {
      const id = this.id();
      untracked(() => {
        this.result.set(null);
        this.suggested.set(null);
        this.error.set('');
        this.tab.set('resultados');
        this.load(id);
      });
    });

    effect(() => {
      const ok = this.fb();
      const err = this.fbError();
      if (!ok && !err) return;
      untracked(() => {
        this.banner.set(err ? { ok: false, text: err } : { ok: true, text: 'Facebook conectado! A Descoberta já pode buscar.' });
        this.router.navigate([], { queryParams: {}, replaceUrl: true });
      });
    });
  }

  private async load(id: string): Promise<void> {
    try {
      const [fb, usage, saved] = await Promise.all([this.api.facebookStatus(), this.api.discoveryUsage(id), this.api.discoverySaved(id)]);
      this.fbStatus.set(fb);
      this.usage.set(usage.usage);
      this.via.set(usage.via);
      this.saved.set(saved);
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  protected shown(list: DiscoveredProfile[]): DiscoveredProfile[] {
    return filterProfiles(list, this.filter());
  }

  patchFilter(changes: Partial<ProfileFilter>): void {
    this.filter.update((f) => ({ ...f, ...changes }));
  }

  submit(event: Event): void {
    event.preventDefault();
    if (this.canSearch()) this.search(this.term());
  }

  async search(q: string): Promise<void> {
    this.term.set(q);
    this.tab.set('resultados');
    this.searching.set(true);
    this.error.set('');
    try {
      const r = await this.api.discoverySearch(this.id(), q);
      this.result.set(r);
      if (r.usage) this.usage.set(r.usage);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.searching.set(false);
    }
  }

  async openSuggestions(force = false): Promise<void> {
    this.tab.set('sugestoes');
    if (this.suggested() && !force) return;
    this.loadingSuggestions.set(true);
    this.error.set('');
    try {
      this.suggested.set(await this.api.discoverySuggestions(this.id()));
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loadingSuggestions.set(false);
    }
  }

  async openSaved(): Promise<void> {
    this.tab.set('salvos');
    try {
      this.saved.set(await this.api.discoverySaved(this.id()));
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  async addWatch(event: Event): Promise<void> {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    this.error.set('');
    try {
      const p = await this.api.addToWatchlist(this.id(), String(new FormData(form).get('username') ?? ''));
      this.saved.update((list) => [p, ...list.filter((x) => x.id !== p.id)]);
      form.reset();
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  /** Atualiza o perfil alterado em todas as listas da tela. */
  replace(p: DiscoveredProfile): void {
    const swap = (list: DiscoveredProfile[]) => list.map((x) => (x.id === p.id ? p : x));
    this.result.update((r) => (r ? { ...r, profiles: swap(r.profiles) } : r));
    this.suggested.update((s) => (s ? { ...s, profiles: swap(s.profiles) } : s));
    const keep = p.watch || p.status === 'salvo' || p.status === 'em_contato';
    this.saved.update((list) => (keep ? (list.some((x) => x.id === p.id) ? swap(list) : [p, ...list]) : list.filter((x) => x.id !== p.id)));
  }

  async connectFacebook(): Promise<void> {
    this.busy.set(true);
    try {
      const { url } = await this.api.facebookConnect(this.id());
      window.location.href = url;
    } catch (e) {
      this.error.set(errorMessage(e));
      this.busy.set(false);
    }
  }

  async disconnectFacebook(): Promise<void> {
    if (!confirm('Desconectar o Facebook? A busca por hashtag e os dados públicos param até reconectar.')) return;
    await this.api.facebookDisconnect();
    await this.load(this.id());
  }
}
