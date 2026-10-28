import { TestBed } from '@angular/core/testing';
import { Api, GenJob } from '../../core/api';
import { PostGenerator } from './post-generator';

/** Acesso aos membros protegidos usados no teste. */
interface Harness {
  rows(): unknown[];
  add(): void;
  update(i: number, change: { theme?: string; kind?: string }): void;
  start(): Promise<void>;
  finished: PostGenerator['finished'];
  open: PostGenerator['open'];
}

const STATUS = { jev: true, stock: false, maxItems: 3, target: 75, maxRewrites: 2 };

describe('PostGenerator', () => {
  afterEach(() => vi.useRealTimers());

  function setup(api: Record<string, unknown>) {
    TestBed.configureTestingModule({
      providers: [{ provide: Api, useValue: { generateStatus: vi.fn().mockResolvedValue(STATUS), ...api } }],
    });
    const fixture = TestBed.createComponent(PostGenerator);
    fixture.componentRef.setInput('accountId', 'loja');
    fixture.detectChanges();
    return fixture;
  }

  const flush = () => new Promise((ok) => setTimeout(ok));

  it('adiciona posts até o limite e envia só os temas preenchidos', async () => {
    const job: GenJob = { id: 'j1', accountId: 'loja', rewrite: true, media: false, done: false, items: [] };
    const generate = vi.fn().mockResolvedValue(job);
    const fixture = setup({ generate, generateJob: vi.fn().mockResolvedValue({ ...job, done: true }) });
    await flush();
    fixture.detectChanges();
    const c = fixture.componentInstance as unknown as Harness;

    c.add();
    c.add();
    c.add(); // limite 3
    expect(c.rows().length).toBe(3);
    c.update(0, { theme: 'Sala pequena', kind: 'carousel' });
    c.update(2, { theme: '  Bastidores  ', kind: 'reel' });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Gerar 2 post(s)');
    expect(el.textContent).toContain('PIXABAY_API_KEY');

    await c.start();
    expect(generate).toHaveBeenCalledWith('loja', {
      items: [
        { theme: 'Sala pequena', kind: 'carousel' },
        { theme: 'Bastidores', kind: 'reel' },
      ],
      rewrite: true,
      media: false,
    });
  });

  it('mostra o progresso, as notas do Jev e avisa quando termina', async () => {
    vi.useFakeTimers();
    const running: GenJob = {
      id: 'j1',
      accountId: 'loja',
      rewrite: true,
      media: true,
      done: false,
      items: [{ theme: 'Tema', kind: 'image', step: 'reescrevendo', grades: [48], notes: [] }],
    };
    const done: GenJob = {
      ...running,
      done: true,
      items: [{ theme: 'Tema', title: 'Post pronto', kind: 'image', step: 'pronto', grades: [48, 82], draftId: 7, notes: ['Sem foto'] }],
    };
    const fixture = setup({ generate: vi.fn().mockResolvedValue(running), generateJob: vi.fn().mockResolvedValue(done) });
    const c = fixture.componentInstance as unknown as Harness;
    const finished = vi.fn();
    const opened: number[] = [];
    c.finished.subscribe(finished);
    c.open.subscribe((id: number) => opened.push(id));

    c.update(0, { theme: 'Tema' });
    await c.start();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Claude reescrevendo com as dicas do Jev');

    await vi.advanceTimersByTimeAsync(2100);
    fixture.detectChanges();
    expect(finished).toHaveBeenCalled();
    expect(el.textContent).toContain('48 → 82');
    expect(el.textContent).toContain('Sem foto');
    (Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('Abrir rascunho')) as HTMLButtonElement).click();
    expect(opened).toEqual([7]);
  });
});
