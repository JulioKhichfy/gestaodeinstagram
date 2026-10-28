import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AccountsStore } from '../../core/accounts';
import { Api, Overview, errorMessage } from '../../core/api';
import { dateTimeBR } from '../../core/format';

const DAY = 24 * 60 * 60 * 1000;

/** Layout de uma conta: perfil, conexão, sincronização e as seções (sub-rotas). */
@Component({
  selector: 'app-account',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './account.html',
  styleUrl: './account.scss',
})
export class AccountPage {
  private api = inject(Api);
  protected store = inject(AccountsStore);
  private router = inject(Router);

  /** Parâmetros de rota/query ligados via withComponentInputBinding. */
  readonly id = input.required<string>();
  readonly connected = input<string>();
  readonly error = input<string>();

  protected readonly sections = [
    { path: 'publicar', label: 'Publicar' },
    { path: 'rascunhos', label: 'Rascunhos' },
    { path: 'relatorios', label: 'Relatórios' },
    { path: 'posts', label: 'Posts e experimentos' },
    { path: 'ciclos', label: 'Ciclos de 10 dias' },
    { path: 'trafego', label: 'Tráfego pago' },
    { path: 'descoberta', label: 'Descoberta' },
  ];

  protected account = computed(() => this.store.byId(this.id()));
  protected overview = signal<Overview | null>(null);
  protected loading = signal(false);
  protected banner = signal<{ kind: 'ok' | 'error' | 'info'; text: string } | null>(null);
  protected connecting = signal(false);
  protected dateTime = dateTimeBR;

  protected tokenDaysLeft = computed(() => {
    const exp = this.account()?.tokenExpiresAt;
    return exp ? Math.max(0, Math.floor((exp - Date.now()) / DAY)) : null;
  });
  protected lastSync = computed(() => this.store.syncStatus().find((s) => s.accountId === this.id()));

  private loadSeq = 0;

  constructor() {
    // Volta do OAuth: mostra o resultado e limpa a URL.
    effect(() => {
      const ok = this.connected();
      const err = this.error();
      if (!ok && !err) return;
      untracked(() => {
        this.banner.set(
          err ? { kind: 'error', text: err } : { kind: 'ok', text: 'Instagram conectado! Sincronizando métricas em segundo plano…' },
        );
        this.router.navigate([], { queryParams: {}, replaceUrl: true });
        if (ok) this.store.reload().then(() => this.store.watchSync());
      });
    });

    effect(() => {
      const id = this.id();
      const connected = this.account()?.connected ?? false;
      untracked(() => this.load(id, connected));
    });
  }

  private async load(id: string, connected: boolean): Promise<void> {
    const seq = ++this.loadSeq;
    this.overview.set(null);
    if (!connected) return;
    this.loading.set(true);
    try {
      const overview = await this.api.overview(id);
      if (seq === this.loadSeq) this.overview.set(overview);
    } catch (e) {
      if (seq === this.loadSeq) this.banner.set({ kind: 'error', text: errorMessage(e) });
    } finally {
      if (seq === this.loadSeq) this.loading.set(false);
    }
  }

  async connect(): Promise<void> {
    this.connecting.set(true);
    this.banner.set(null);
    try {
      const { url } = await this.api.connect(this.id());
      window.location.href = url;
    } catch (e) {
      this.banner.set({ kind: 'error', text: errorMessage(e) });
      this.connecting.set(false);
    }
  }

  async disconnect(): Promise<void> {
    const acc = this.account();
    if (!acc || !confirm(`Desconectar @${acc.username} do dashboard?`)) return;
    await this.api.disconnect(acc.id);
    await this.store.reload();
  }

  async sync(): Promise<void> {
    try {
      await this.api.syncAccount(this.id());
      this.banner.set({ kind: 'info', text: 'Sincronizando… os relatórios atualizam em instantes.' });
      this.store.watchSync();
    } catch (e) {
      this.banner.set({ kind: 'error', text: errorMessage(e) });
    }
  }
}
