import { ChangeDetectionStrategy, Component, effect, inject, input, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { AccountsStore } from '../../core/accounts';
import { Api, BusinessType, ContasView, errorMessage } from '../../core/api';

export const BUSINESS_LABELS: Record<BusinessType, string> = {
  livros: 'Livros / autora',
  servicos: 'Serviços (cursos, palestras, consultoria, projetos)',
  loja: 'Loja (produtos)',
  conteudo: 'Página de conteúdo (mídia, fã, notícias)',
};

/**
 * Contas: entrar com o Facebook e adicionar as contas do Instagram vinculadas às Páginas; renomear, mudar o tipo,
 * editar o perfil (o que o assistente e o Jev sabem da conta) e remover.
 */
@Component({
  selector: 'app-contas',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card">
      <h1>Contas</h1>
      <p class="muted small">Adicione aqui as contas do Instagram que o dashboard vai gerenciar. O jeito mais fácil: entre com o
        Facebook, e as contas profissionais vinculadas às suas Páginas aparecem para adicionar com um clique.</p>
      @if (message()) { <p class="alert ok">{{ message() }}</p> }
      @if (error()) { <p class="alert error">{{ error() }}</p> }
    </section>

    <section class="card">
      <h2>1. Entrar com o Facebook</h2>
      @if (view()?.facebook; as f) {
        <p>Conectado como <strong>{{ f.name }}</strong>@if (!f.connected) { <span class="alert warn inline">acesso vencido: entre de novo</span> }.</p>
      } @else {
        <p class="muted">Ainda não conectado.</p>
      }
      <button type="button" class="btn primary" [disabled]="busy()" (click)="connectFacebook()"
              title="Abre o login oficial do Facebook; aceite todas as permissões e marque as Páginas e contas do Instagram">
        {{ view()?.facebook ? 'Entrar de novo (atualizar a lista)' : 'Entrar com o Facebook' }}
      </button>

      @if (view()?.available?.length) {
        <h3>Contas do Instagram encontradas</h3>
        <ul class="list">
          @for (a of view()!.available; track a.igUserId) {
            <li>
              <span><strong>&#64;{{ a.username }}</strong>@if (a.page) { <small class="muted"> · Página {{ a.page }}</small> }</span>
              @if (a.added) {
                <span class="pill ok">já adicionada</span>
              } @else {
                <select [value]="typeFor(a.username)" (change)="setType(a.username, $any($event.target).value)" aria-label="Tipo de negócio"
                        title="Orienta o assistente, as dicas de tráfego pago e os relatórios">
                  @for (b of businessTypes; track b) { <option [value]="b">{{ businessLabels[b] }}</option> }
                </select>
                <button type="button" class="btn primary" [disabled]="busy()" (click)="add(a.username, a.page ?? '')" title="Adiciona ao dashboard já conectada">Adicionar</button>
              }
            </li>
          }
        </ul>
      } @else if (view()?.facebook) {
        <p class="alert warn">Nenhuma conta do Instagram apareceu. A conta precisa ser <strong>profissional</strong> e estar
          <strong>vinculada a uma Página do Facebook</strong> que você administra (Instagram › Editar perfil › Página). Depois,
          entre de novo e, na janela do Facebook, clique em "Editar acesso" para marcar a conta.</p>
      }
    </section>

    <section class="card">
      <h2>2. Suas contas no dashboard</h2>
      @for (a of view()?.accounts ?? []; track a.id) {
        <article class="account">
          <div class="row">
            <input type="text" [value]="a.label" (change)="update(a.id, { label: $any($event.target).value })" aria-label="Nome da aba" title="Nome que aparece na aba" />
            <span class="muted">&#64;{{ a.username }}</span>
            <select [value]="a.business" (change)="update(a.id, { business: $any($event.target).value })" aria-label="Tipo de negócio" title="Tipo de negócio">
              @for (b of businessTypes; track b) { <option [value]="b">{{ businessLabels[b] }}</option> }
            </select>
            <span class="pill" [class.ok]="a.connected" [title]="a.connected ? 'Conectada' + (a.via === 'facebook' ? ' pelo Facebook' : '') : 'Conecte pela aba da conta ou entrando com o Facebook'">
              {{ a.connected ? 'Conectada' : 'Não conectada' }}
            </span>
            <span class="spacer"></span>
            <button type="button" class="btn ghost" (click)="toggleProfile(a.id)" title="O que o assistente e o Jev sabem da conta: público, tom de voz, produtos, regras">
              {{ profileOpen() === a.id ? 'Fechar perfil' : 'Perfil da conta' }}
            </button>
            <button type="button" class="btn ghost danger" (click)="remove(a.id, a.username)" title="Tira do dashboard (as métricas e o perfil ficam guardados)">Remover</button>
          </div>
          @if (profileOpen() === a.id) {
            <label class="field">
              <span>Perfil da conta (preencha com calma: quanto mais completo, melhores os textos)</span>
              <textarea rows="16" [value]="profile()" (input)="profile.set($any($event.target).value)"></textarea>
            </label>
            <div class="row end">
              <small class="muted">{{ profile().length }} caracteres</small>
              <button type="button" class="btn primary" [disabled]="busy()" (click)="saveProfile(a.id)" title="Salvar o perfil">Salvar perfil</button>
            </div>
          }
        </article>
      } @empty {
        <p class="muted">Nenhuma conta ainda. Entre com o Facebook acima, ou adicione pelo &#64; abaixo.</p>
      }
    </section>

    <section class="card">
      <h2>3. Adicionar pelo &#64; (sem o Facebook)</h2>
      <p class="muted small">Para contas que você vai conectar pelo login do Instagram, na aba da conta.</p>
      <form class="row" (submit)="addManual($event)">
        <input name="username" type="text" placeholder="@da.conta" aria-label="@ da conta" required />
        <input name="label" type="text" placeholder="Nome da aba (opcional)" aria-label="Nome da aba" />
        <select name="business" aria-label="Tipo de negócio">
          @for (b of businessTypes; track b) { <option [value]="b">{{ businessLabels[b] }}</option> }
        </select>
        <button class="btn ghost" type="submit" [disabled]="busy()" title="Adiciona a conta (depois conecte na aba dela)">Adicionar</button>
      </form>
    </section>
  `,
  styles: `
    :host { display: grid; gap: 16px; }
    h1 { margin: 0 0 4px; font-size: 1.3rem; }
    h2 { margin: 0 0 8px; font-size: 1.05rem; }
    h3 { margin: 14px 0 8px; font-size: .95rem; }
    .small { font-size: .88rem; margin: 0; }
    .list { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px;
      li { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; border-bottom: 1px solid var(--border); padding-bottom: 8px; }
      li > span:first-child { flex: 1; min-width: 200px; } }
    .account { border-top: 1px solid var(--border); padding: 10px 0; display: grid; gap: 8px; }
    .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .row.end { justify-content: flex-end; }
    .spacer { flex: 1; }
    .inline { display: inline; padding: 2px 6px; margin-left: 6px; }
    textarea { font-family: inherit; }
  `,
})
export class ContasPage {
  private api = inject(Api);
  private store = inject(AccountsStore);
  private router = inject(Router);

  /** Volta do login do Facebook (?fb=1, ?fbError=, ?semInstagram=). */
  readonly fb = input<string>();
  readonly fbError = input<string>();
  readonly semInstagram = input<string>();

  protected readonly businessTypes = Object.keys(BUSINESS_LABELS) as BusinessType[];
  protected readonly businessLabels = BUSINESS_LABELS;
  protected view = signal<ContasView | null>(null);
  protected busy = signal(false);
  protected message = signal('');
  protected error = signal('');
  protected profileOpen = signal<string | null>(null);
  protected profile = signal('');
  private types = signal<Record<string, BusinessType>>({});

  constructor() {
    effect(() => {
      const ok = this.fb();
      const err = this.fbError();
      const without = this.semInstagram();
      untracked(() => {
        if (ok) this.message.set('Login do Facebook feito. Adicione abaixo as contas que quer gerenciar.' + (without ? ` Páginas sem Instagram vinculado: ${without}.` : ''));
        if (err) this.error.set(err);
        if (ok || err) this.router.navigate([], { queryParams: {}, replaceUrl: true });
      });
    });
    this.load();
  }

  typeFor = (username: string): BusinessType => this.types()[username] ?? 'servicos';
  setType = (username: string, b: BusinessType) => this.types.update((t) => ({ ...t, [username]: b }));

  private async load(): Promise<void> {
    try {
      this.view.set(await this.api.contas());
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  private async run(action: () => Promise<unknown>, done?: string): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      await action();
      if (done) this.message.set(done);
      await Promise.all([this.load(), this.store.reload()]);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  async connectFacebook(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      const { url } = await this.api.facebookConnect('', 'contas');
      window.location.href = url;
    } catch (e) {
      this.error.set(errorMessage(e));
      this.busy.set(false);
    }
  }

  add(username: string, page: string): Promise<void> {
    return this.run(
      () => this.api.addConta({ username, label: page || `@${username}`, business: this.typeFor(username) }),
      `@${username} adicionada. Preencha o "Perfil da conta" para o assistente escrever no tom certo.`,
    );
  }

  addManual(event: Event): Promise<void> {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const data = new FormData(form);
    return this.run(async () => {
      await this.api.addConta({ username: String(data.get('username') ?? ''), label: String(data.get('label') ?? ''), business: String(data.get('business')) as BusinessType });
      form.reset();
    }, 'Conta adicionada. Conecte na aba dela.');
  }

  update(id: string, body: { label?: string; business?: BusinessType }): Promise<void> {
    return this.run(() => this.api.updateConta(id, body));
  }

  remove(id: string, username: string): Promise<void> {
    if (!confirm(`Remover @${username} do dashboard? As métricas e o perfil ficam guardados, caso você adicione de novo.`)) return Promise.resolve();
    return this.run(() => this.api.removeConta(id), `@${username} removida.`);
  }

  async toggleProfile(id: string): Promise<void> {
    if (this.profileOpen() === id) return this.profileOpen.set(null);
    try {
      this.profile.set((await this.api.contaPerfil(id)).text);
      this.profileOpen.set(id);
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  saveProfile(id: string): Promise<void> {
    return this.run(() => this.api.saveContaPerfil(id, this.profile()), 'Perfil salvo.');
  }
}
