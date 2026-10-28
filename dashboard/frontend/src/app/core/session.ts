import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import type { Session } from './api';

const KEY = 'ig-dashboard-session';

/**
 * Sessão do dashboard. "Manter conectado" guarda no localStorage (sobrevive a fechar o navegador);
 * sem ele, fica no sessionStorage (some ao fechar a aba).
 */
@Injectable({ providedIn: 'root' })
export class SessionStore {
  private session = signal<Session | null>(this.restore());

  readonly token = computed(() => this.session()?.token ?? null);
  readonly loggedIn = computed(() => {
    const s = this.session();
    return Boolean(s && s.expiresAt > Date.now());
  });

  start(session: Session, remember: boolean): void {
    this.clear();
    (remember ? localStorage : sessionStorage).setItem(KEY, JSON.stringify(session));
    this.session.set(session);
  }

  clear(): void {
    localStorage.removeItem(KEY);
    sessionStorage.removeItem(KEY);
    this.session.set(null);
  }

  private restore(): Session | null {
    try {
      const raw = localStorage.getItem(KEY) ?? sessionStorage.getItem(KEY);
      const s = raw ? (JSON.parse(raw) as Session) : null;
      return s && s.expiresAt > Date.now() ? s : null;
    } catch {
      return null;
    }
  }
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const session = inject(SessionStore);
  const router = inject(Router);
  const token = session.token();
  const authed = token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;
  return next(authed).pipe(
    catchError((e: HttpErrorResponse) => {
      if (e.status === 401 && !req.url.includes('/session/')) {
        session.clear();
        router.navigate(['/login']);
      }
      return throwError(() => e);
    }),
  );
};

export const authGuard: CanActivateFn = () =>
  inject(SessionStore).loggedIn() || inject(Router).createUrlTree(['/login']);
