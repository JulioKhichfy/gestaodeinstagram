import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Api, errorMessage } from '../../core/api';
import { SessionStore } from '../../core/session';

@Component({
  selector: 'app-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="login">
      <form class="card" (submit)="submit($event)">
        <div class="brand">
          <span class="logo"></span>
          <h1>Guarda-chuva Instagram</h1>
        </div>

        @if (hasPassword() === null) {
          <p class="muted">Carregando…</p>
        } @else {
          <p class="muted">
            @if (hasPassword()) {
              Entre com a senha do dashboard.
            } @else {
              Primeiro acesso: crie a senha do dashboard (mínimo 8 caracteres).
              Ela protege o painel; não é a senha do Instagram.
            }
          </p>

          <label class="field">
            <span>Senha</span>
            <input type="password" autocomplete="current-password"
                   [value]="password()" (input)="password.set($any($event.target).value)" />
          </label>

          @if (!hasPassword()) {
            <label class="field">
              <span>Confirmar senha</span>
              <input type="password" autocomplete="new-password"
                     [value]="confirm()" (input)="confirm.set($any($event.target).value)" />
            </label>
          }

          <label class="check">
            <input type="checkbox" [checked]="remember()" (change)="remember.set($any($event.target).checked)" />
            Manter conectado (30 dias)
          </label>

          @if (error()) {
            <p class="alert error">{{ error() }}</p>
          }

          <button class="btn primary" type="submit" [disabled]="busy()">
            {{ hasPassword() ? 'Entrar' : 'Criar senha e entrar' }}
          </button>
        }
      </form>
    </main>
  `,
  styles: `
    .login { min-height: 100vh; display: grid; place-items: center; padding: 16px; }
    .card { width: min(380px, 100%); display: grid; gap: 16px; }
    .brand { display: flex; align-items: center; gap: 12px; }
    h1 { font-size: 1.2rem; margin: 0; }
  `,
})
export class LoginPage {
  private api = inject(Api);
  private session = inject(SessionStore);
  private router = inject(Router);

  protected hasPassword = signal<boolean | null>(null);
  protected password = signal('');
  protected confirm = signal('');
  protected remember = signal(true);
  protected error = signal('');
  protected busy = signal(false);

  constructor() {
    if (this.session.loggedIn()) this.router.navigate(['/']);
    this.api
      .sessionStatus()
      .then((s) => this.hasPassword.set(s.hasPassword))
      .catch((e) => this.error.set(errorMessage(e)));
  }

  async submit(event: Event): Promise<void> {
    event.preventDefault();
    this.error.set('');
    if (!this.hasPassword() && this.password() !== this.confirm()) {
      this.error.set('As senhas não conferem.');
      return;
    }
    this.busy.set(true);
    try {
      const remember = this.remember();
      const session = this.hasPassword()
        ? await this.api.login(this.password(), remember)
        : await this.api.setup(this.password(), remember);
      this.session.start(session, remember);
      this.router.navigate(['/']);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
