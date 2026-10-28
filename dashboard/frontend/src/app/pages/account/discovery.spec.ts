import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Api, HashtagUsage } from '../../core/api';
import { DiscoveryPage } from './discovery';

const usage = (used: number): HashtagUsage => ({
  used,
  limit: 30,
  remaining: 30 - used,
  hashtags: Array.from({ length: used }, (_, i) => ({ hashtag: `tag${i}`, queriedAt: 0, freesAt: 0 })),
});

describe('DiscoveryPage', () => {
  async function setup(used: number) {
    const api = {
      facebookStatus: vi.fn().mockResolvedValue({
        missing: [], redirectUri: '', connected: true, name: 'Cliente Exemplo', expiresAt: Date.now() + 1e9,
        missingPermissions: [], linked: [{ accountId: 'loja', username: 'loja.exemplo', linked: true }],
      }),
      discoveryUsage: vi.fn().mockResolvedValue({ via: 'loja', usage: usage(used) }),
      discoverySaved: vi.fn().mockResolvedValue([]),
      discoverySearch: vi.fn().mockResolvedValue({ hashtag: 'casa', cached: false, fetchedAt: 0, posts: [], profiles: [], usage: usage(used) }),
    };
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: Api, useValue: api }] });
    const fixture = TestBed.createComponent(DiscoveryPage);
    fixture.componentRef.setInput('id', 'loja');
    fixture.detectChanges();
    await new Promise((ok) => setTimeout(ok)); // deixa as cargas (promises) terminarem
    fixture.detectChanges();
    return { fixture, api, el: fixture.nativeElement as HTMLElement };
  }

  const type = (el: HTMLElement, value: string) => {
    const input = el.querySelector('input[type=search]') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };
  const button = (el: HTMLElement) => el.querySelector('form.search button[type=submit]') as HTMLButtonElement;

  it('mostra o contador e a hashtag que será consultada', async () => {
    const { fixture, el, api } = await setup(3);
    expect(el.textContent).toContain('3 de 30');
    type(el, 'Decoração Afetiva');
    fixture.detectChanges();
    expect(el.textContent).toContain('#decoracaoafetiva');
    expect(button(el).disabled).toBe(false);
    button(el).click();
    expect(api.discoverySearch).toHaveBeenCalledWith('loja', 'Decoração Afetiva');
  });

  it('bloqueia hashtag nova ao atingir 30, mas permite repetir as já consultadas', async () => {
    const { fixture, el } = await setup(30);
    type(el, 'nova');
    fixture.detectChanges();
    expect(button(el).disabled).toBe(true);
    expect(el.textContent).toContain('Limite de 30 hashtags atingido');
    type(el, 'tag7');
    fixture.detectChanges();
    expect(button(el).disabled).toBe(false);
  });
});
