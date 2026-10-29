import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Api, ScheduledPost } from '../../core/api';
import { AgendaPage } from './agenda';

const post = (over: Partial<ScheduledPost>): ScheduledPost => ({
  id: 1,
  accountId: 'teste',
  type: 'image',
  caption: 'Legenda',
  items: 1,
  scheduledAt: Date.now() + 3_600_000,
  status: 'agendado',
  draftId: null,
  error: null,
  permalink: null,
  publishedAt: null,
  ...over,
});

const flush = () => new Promise((ok) => setTimeout(ok));
const button = (el: HTMLElement, text: string) =>
  Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes(text)) as HTMLButtonElement;

describe('Agendados', () => {
  afterEach(() => vi.restoreAllMocks());

  function setup(api: Record<string, unknown>) {
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: Api, useValue: api }] });
    const fixture = TestBed.createComponent(AgendaPage);
    fixture.componentRef.setInput('id', 'teste');
    fixture.detectChanges();
    return fixture;
  }

  it('separa próximos (inclusive falhas) do histórico e mostra o motivo da falha', async () => {
    const fixture = setup({
      scheduleList: vi.fn().mockResolvedValue([
        post({ id: 1, type: 'story', caption: '' }),
        post({ id: 2, status: 'falhou', error: 'O endereço público (túnel) estava desligado no horário' }),
        post({ id: 3, status: 'publicado', permalink: 'https://instagram.com/p/x', publishedAt: Date.now() }),
      ]),
    });
    await flush();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Próximos (2)');
    expect(el.textContent).toContain('(Story: o texto está na imagem)');
    expect(el.textContent).toContain('túnel) estava desligado');
    expect(el.textContent).toContain('Últimos 30 dias');
    expect(el.querySelector<HTMLAnchorElement>('a[href="https://instagram.com/p/x"]')).toBeTruthy();
  });

  it('publicar agora atualiza o item; cancelar pede confirmação', async () => {
    const publishScheduled = vi.fn().mockResolvedValue(post({ status: 'publicado', permalink: 'https://instagram.com/p/y', publishedAt: Date.now() }));
    const cancelScheduled = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const fixture = setup({ scheduleList: vi.fn().mockResolvedValue([post({})]), publishScheduled, cancelScheduled });
    await flush();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    button(el, 'Cancelar').click();
    expect(cancelScheduled).not.toHaveBeenCalled();

    button(el, 'Publicar agora').click();
    await flush();
    fixture.detectChanges();
    expect(publishScheduled).toHaveBeenCalledWith(1);
    expect(el.textContent).toContain('Próximos (0)');
    expect(el.textContent).toContain('Publicado');
  });
});
