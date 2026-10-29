import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Api, GenJob, MovieCatalog } from '../../core/api';
import { MoviesPage } from './movies';

const CATALOG: MovieCatalog = {
  maxPosts: 20,
  groups: [
    {
      id: 'filmes',
      label: 'Filmes',
      options: [
        { id: 'lancamentos', label: 'Calendário de lançamento', current: true },
        { id: 'genero', label: 'Pesquisar filmes por gênero', current: false, extra: 'Gênero (ex.: suspense)' },
      ],
    },
    { id: 'tv', label: 'Programas de TV', options: [{ id: 'top-series', label: 'As 250 séries mais bem avaliadas', current: false }] },
  ],
};

const flush = () => new Promise((ok) => setTimeout(ok));
const button = (el: HTMLElement, text: string) =>
  Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes(text)) as HTMLButtonElement;
const change = (el: HTMLInputElement | HTMLSelectElement, value: string, event = 'change') => {
  el.value = value;
  el.dispatchEvent(new Event(event));
};

describe('Central de Filmes', () => {
  function setup(api: Record<string, unknown>) {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: Api, useValue: { movieCatalog: vi.fn().mockResolvedValue(CATALOG), ...api } }],
    });
    const fixture = TestBed.createComponent(MoviesPage);
    fixture.componentRef.setInput('id', 'teste');
    fixture.detectChanges();
    return fixture;
  }

  it('uma linha por formato; envia só as linhas com quantidade, com menu, opção e gênero', async () => {
    const job: GenJob = { id: 'j', accountId: 'teste', rewrite: true, media: false, done: false, phase: 'planejando', items: [] };
    const generateMovies = vi.fn().mockResolvedValue(job);
    const fixture = setup({ generateMovies, generateJob: vi.fn().mockResolvedValue(job) });
    await flush();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    const rows = el.querySelectorAll('.row');
    expect(rows.length).toBe(4);
    expect(el.textContent).toContain('📰 Calendário de lançamento');
    expect(button(el, 'Gerar posts').disabled).toBe(true);

    // Linha 2 (Carrossel): 3 posts de filmes por gênero "suspense"
    const row2 = rows[1];
    change(row2.querySelector<HTMLInputElement>('input.qty')!, '3', 'input');
    change(row2.querySelectorAll('select')[2] as HTMLSelectElement, 'genero');
    fixture.detectChanges();
    change(row2.querySelector<HTMLInputElement>('input.extra')!, 'suspense', 'input');
    // Linha 4 (Story): 2 séries
    const row4 = rows[3];
    change(row4.querySelector<HTMLInputElement>('input.qty')!, '2', 'input');
    change(row4.querySelectorAll('select')[1] as HTMLSelectElement, 'tv');
    fixture.detectChanges();
    expect(el.textContent).toContain('5 de no máximo 20 posts');

    button(el, 'Gerar posts').click();
    await flush();
    fixture.detectChanges();
    expect(generateMovies).toHaveBeenCalledWith(
      'teste',
      [
        { group: 'filmes', option: 'genero', kind: 'carousel', qty: 3, extra: 'suspense' },
        { group: 'tv', option: 'top-series', kind: 'story', qty: 2, extra: undefined },
      ],
      true,
    );
    expect(el.textContent).toContain('O Claude está escolhendo os títulos');
  });
});
