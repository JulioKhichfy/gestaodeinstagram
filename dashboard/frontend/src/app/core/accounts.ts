import { Injectable, computed, inject, signal } from '@angular/core';
import { Account, Alert, Api } from './api';

export interface SyncStatus {
  accountId: string;
  syncing: boolean;
  lastSuccessAt: number | null;
  lastError: string | null;
}

/** Contas, status de sincronização e alertas, compartilhados entre abas e páginas. */
@Injectable({ providedIn: 'root' })
export class AccountsStore {
  private api = inject(Api);

  readonly accounts = signal<Account[]>([]);
  readonly syncStatus = signal<SyncStatus[]>([]);
  readonly alerts = signal<Record<string, Alert[]>>({});
  /** Incrementa quando uma sincronização termina: páginas de relatório recarregam. */
  readonly dataVersion = signal(0);
  readonly anySyncing = computed(() => this.accounts().some((a) => a.syncing));

  private watching = false;

  async reload(): Promise<void> {
    const [accounts, status, alerts] = await Promise.all([
      this.api.accounts(),
      this.api.syncStatus(),
      this.api.alerts().catch(() => []),
    ]);
    this.accounts.set(accounts);
    this.syncStatus.set(status);
    this.alerts.set(Object.fromEntries(alerts.map((a) => [a.accountId, a.alerts])));
  }

  byId(id: string): Account | undefined {
    return this.accounts().find((a) => a.id === id);
  }

  /** Acompanha a sincronização até terminar e avisa as páginas para recarregar. */
  async watchSync(): Promise<void> {
    if (this.watching) return;
    this.watching = true;
    try {
      await new Promise((ok) => setTimeout(ok, 1500));
      await this.reload();
      while (this.anySyncing()) {
        await new Promise((ok) => setTimeout(ok, 4000));
        await this.reload();
      }
      this.dataVersion.update((v) => v + 1);
    } finally {
      this.watching = false;
    }
  }
}
