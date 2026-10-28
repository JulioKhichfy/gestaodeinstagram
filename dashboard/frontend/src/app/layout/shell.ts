import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AccountsStore } from '../core/accounts';
import { Api, ServerConfig, errorMessage } from '../core/api';
import { SessionStore } from '../core/session';

@Component({
  selector: 'app-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <header class="topbar">
      <a class="brand" routerLink="/visao-geral">
        <span class="logo"></span>
        <strong>Guarda-chuva Instagram</strong>
      </a>
      <nav class="main-nav" aria-label="Principal">
        <a routerLink="/visao-geral" routerLinkActive="active">Visão geral</a>
        <a routerLink="/ajuda" routerLinkActive="active">Ajuda</a>
        <a routerLink="/configuracoes" routerLinkActive="active">Configurações</a>
        <button class="btn ghost" (click)="logout()">Sair</button>
      </nav>
    </header>

    <nav class="tabs" aria-label="Contas">
      @for (a of store.accounts(); track a.id) {
        <a class="tab" [routerLink]="['/conta', a.id]" routerLinkActive="active">
          <span class="dot" [class.on]="a.connected" [title]="a.connected ? 'Conectada' : 'Não conectada'"></span>
          <span class="tab-label">{{ a.label }}
            @if (alertCount(a.id); as n) {
              <span class="badge" [title]="n + ' alerta(s)'">{{ n }}</span>
            }
          </span>
          <small>&#64;{{ a.username }}</small>
        </a>
      }
    </nav>

    @if (error()) {
      <p class="alert error page">{{ error() }}</p>
    }
    @if (config()?.missing?.length) {
      <div class="alert warn page">
        <strong>Configuração pendente.</strong>
        Preencha em <code>dashboard/backend/.env</code>: {{ config()!.missing.join(', ') }}.
        Passo a passo em <code>dashboard/SETUP.md</code>. Reinicie o backend depois.
      </div>
    }

    <main class="page">
      <router-outlet />
    </main>
  `,
  styles: `
    .topbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 10px 24px;
      background: var(--surface); border-bottom: 1px solid var(--border); flex-wrap: wrap; }
    .brand { display: flex; align-items: center; gap: 10px; color: var(--text); text-decoration: none; }
    .main-nav { display: flex; align-items: center; gap: 4px; flex-wrap: wrap;
      a { padding: 8px 12px; border-radius: 8px; color: var(--muted); text-decoration: none; font-weight: 600; }
      a.active, a:hover { color: var(--text); background: var(--surface-2); } }
    .tabs { display: flex; gap: 4px; padding: 0 24px; background: var(--surface);
      border-bottom: 1px solid var(--border); overflow-x: auto; }
    .tab { display: grid; grid-template-columns: auto 1fr; column-gap: 8px; align-items: center;
      padding: 12px 16px; color: var(--muted); text-decoration: none; border-bottom: 3px solid transparent;
      white-space: nowrap; }
    .tab small { grid-column: 2; font-size: .75rem; }
    .tab-label { font-weight: 600; }
    .tab.active { color: var(--text); border-bottom-color: var(--accent); }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--border-strong); }
    .dot.on { background: var(--ok); }
    .badge { display: inline-block; min-width: 18px; padding: 0 5px; margin-left: 4px; border-radius: 9px; font-size: .7rem;
      line-height: 18px; text-align: center; background: var(--warn-bg); color: var(--warn-text); }
    .page { max-width: 1200px; margin: 0 auto; padding: 24px; }
    .alert.page { margin-top: 16px; padding: 12px 16px; }
    @media (max-width: 600px) { .topbar, .tabs { padding-inline: 16px; } .page { padding: 16px; } }
  `,
})
export class Shell {
  protected store = inject(AccountsStore);
  private api = inject(Api);
  private session = inject(SessionStore);
  private router = inject(Router);

  protected config = signal<ServerConfig | null>(null);
  protected error = signal('');

  constructor() {
    this.store
      .reload()
      .then(() => {
        if (this.store.anySyncing()) this.store.watchSync();
      })
      .catch((e) => this.error.set(errorMessage(e)));
    this.api.config().then((c) => this.config.set(c)).catch(() => undefined);
  }

  /** Alertas que pedem ação (avisos e erros) por conta. */
  protected alertCount(accountId: string): number {
    return (this.store.alerts()[accountId] ?? []).filter((a) => a.level !== 'info').length;
  }

  async logout(): Promise<void> {
    await this.api.logout().catch(() => undefined);
    this.session.clear();
    this.router.navigate(['/login']);
  }
}
