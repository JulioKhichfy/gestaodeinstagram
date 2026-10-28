import { TestBed } from '@angular/core/testing';
import { SessionStore } from './session';

describe('SessionStore', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('"manter conectado" guarda no localStorage', () => {
    const store = TestBed.inject(SessionStore);
    store.start({ token: 't1', expiresAt: Date.now() + 60_000 }, true);
    expect(localStorage.getItem('ig-dashboard-session')).toContain('t1');
    expect(sessionStorage.getItem('ig-dashboard-session')).toBeNull();
    expect(store.loggedIn()).toBe(true);
    expect(store.token()).toBe('t1');
  });

  it('sem "manter conectado" guarda só na aba (sessionStorage)', () => {
    const store = TestBed.inject(SessionStore);
    store.start({ token: 't2', expiresAt: Date.now() + 60_000 }, false);
    expect(sessionStorage.getItem('ig-dashboard-session')).toContain('t2');
    expect(localStorage.getItem('ig-dashboard-session')).toBeNull();
  });

  it('ignora sessão expirada salva', () => {
    localStorage.setItem('ig-dashboard-session', JSON.stringify({ token: 'velho', expiresAt: Date.now() - 1 }));
    const store = TestBed.inject(SessionStore);
    expect(store.loggedIn()).toBe(false);
    expect(store.token()).toBeNull();
  });

  it('sair limpa tudo', () => {
    const store = TestBed.inject(SessionStore);
    store.start({ token: 't3', expiresAt: Date.now() + 60_000 }, true);
    store.clear();
    expect(store.loggedIn()).toBe(false);
    expect(localStorage.getItem('ig-dashboard-session')).toBeNull();
  });
});
