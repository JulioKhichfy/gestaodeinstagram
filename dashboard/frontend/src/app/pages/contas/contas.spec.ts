import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AccountsStore } from '../../core/accounts';
import { Api, ContasView } from '../../core/api';
import { ContasPage } from './contas';

const VIEW: ContasView = {
  facebook: { name: 'Pessoa', expiresAt: Date.now() + 86_400_000, connected: true },
  available: [
    { igUserId: '1', username: 'loja.nova', page: 'Loja Nova', added: false },
    { igUserId: '2', username: 'ja.esta', added: true },
  ],
  accounts: [{ id: 'ja-esta', label: 'Já está', username: 'ja.esta', business: 'livros', connected: true, via: 'facebook' }],
};

const flush = () => new Promise((ok) => setTimeout(ok));
const button = (el: HTMLElement, text: string) =>
  Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes(text)) as HTMLButtonElement;

describe('Contas', () => {
  function setup(api: Record<string, unknown>) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AccountsStore, useValue: { reload: vi.fn().mockResolvedValue(undefined) } },
        { provide: Api, useValue: { contas: vi.fn().mockResolvedValue(VIEW), ...api } },
      ],
    });
    const fixture = TestBed.createComponent(ContasPage);
    fixture.detectChanges();
    return fixture;
  }

  it('lista as contas do Facebook e adiciona com o tipo escolhido', async () => {
    const addConta = vi.fn().mockResolvedValue({ connected: true });
    const fixture = setup({ addConta });
    await flush();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Conectado como Pessoa');
    expect(el.textContent).toContain('@loja.nova');
    expect(el.textContent).toContain('já adicionada');

    const select = el.querySelector<HTMLSelectElement>('.list select')!;
    select.value = 'loja';
    select.dispatchEvent(new Event('change'));
    button(el, 'Adicionar').click();
    await flush();
    expect(addConta).toHaveBeenCalledWith({ username: 'loja.nova', label: 'Loja Nova', business: 'loja' });
  });

  it('abre e salva o perfil da conta', async () => {
    const saveContaPerfil = vi.fn().mockResolvedValue(undefined);
    const fixture = setup({ contaPerfil: vi.fn().mockResolvedValue({ text: 'Tom: acolhedor' }), saveContaPerfil });
    await flush();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    button(el, 'Perfil da conta').click();
    await flush();
    fixture.detectChanges();
    const area = el.querySelector('textarea')!;
    expect(area.value).toBe('Tom: acolhedor');
    area.value = 'Tom: divertido';
    area.dispatchEvent(new Event('input'));
    button(el, 'Salvar perfil').click();
    await flush();
    expect(saveContaPerfil).toHaveBeenCalledWith('ja-esta', 'Tom: divertido');
  });
});
