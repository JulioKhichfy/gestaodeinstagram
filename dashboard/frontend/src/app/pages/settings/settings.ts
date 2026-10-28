import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Api, Settings, errorMessage } from '../../core/api';

@Component({
  selector: 'app-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Configurações</h1>
    @if (settings(); as s) {
      <form class="card" (submit)="save($event)">
        <h2>Pesos do score de engajamento</h2>
        <p class="muted small">O score soma cada sinal × peso e divide pelo alcance (por 100 contas). Aumente o peso do que é mais
          importante para o seu objetivo. Padrão: compartilhar 5 · salvar 4 · comentar 3 · curtir 1 · visitar perfil 0,5.</p>
        <div class="grid">
          @for (sig of s.signals; track sig.key) {
            <label class="field"><span>{{ sig.label }}</span>
              <input [name]="'w_' + sig.key" type="number" min="0" max="20" step="0.5" [value]="s.weights[sig.key]" /></label>
          }
        </div>

        <h2>Alertas</h2>
        <div class="grid">
          <label class="field"><span>Avisar se ficar sem postar por (dias)</span>
            <input name="noPostDays" type="number" min="1" [value]="s.alerts.noPostDays" /></label>
          <label class="field"><span>Avisar quando o acesso expirar em (dias)</span>
            <input name="tokenDays" type="number" min="1" [value]="s.alerts.tokenDays" /></label>
          <label class="field"><span>Avisar se o alcance semanal cair mais de (%)</span>
            <input name="reachDropPct" type="number" min="5" max="100" [value]="s.alerts.reachDropPct" /></label>
        </div>

        <div class="actions">
          @if (saved()) { <span class="muted">Salvo!</span> }
          <button type="button" class="btn ghost" (click)="restore()">Restaurar padrão</button>
          <button type="submit" class="btn primary">Salvar</button>
        </div>
      </form>
    }
    @if (error()) { <p class="alert error">{{ error() }}</p> }
  `,
  styles: `
    :host { display: grid; gap: 16px; }
    h1 { font-size: 1.3rem; margin: 0; }
    h2 { font-size: 1.05rem; margin: 8px 0; }
    .small { font-size: .85rem; }
    form { display: grid; gap: 12px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
    .actions { display: flex; justify-content: flex-end; align-items: center; gap: 10px; }
  `,
})
export class SettingsPage {
  private api = inject(Api);
  protected settings = signal<Settings | null>(null);
  protected saved = signal(false);
  protected error = signal('');

  constructor() {
    this.api.settings().then((s) => this.settings.set(s)).catch((e) => this.error.set(errorMessage(e)));
  }

  async save(event: Event): Promise<void> {
    event.preventDefault();
    const s = this.settings()!;
    const f = new FormData(event.target as HTMLFormElement);
    const weights = Object.fromEntries(s.signals.map((sig) => [sig.key, Number(f.get('w_' + sig.key))]));
    const alerts = {
      noPostDays: Number(f.get('noPostDays')),
      tokenDays: Number(f.get('tokenDays')),
      reachDropPct: Number(f.get('reachDropPct')),
    };
    await this.persist({ weights, alerts });
  }

  async restore(): Promise<void> {
    const s = this.settings()!;
    await this.persist({ weights: s.defaults.weights, alerts: s.defaults.alerts });
  }

  private async persist(body: Pick<Settings, 'weights' | 'alerts'>): Promise<void> {
    try {
      const r = await this.api.saveSettings(body);
      this.settings.update((s) => (s ? { ...s, ...r } : s));
      this.saved.set(true);
      setTimeout(() => this.saved.set(false), 2000);
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }
}
