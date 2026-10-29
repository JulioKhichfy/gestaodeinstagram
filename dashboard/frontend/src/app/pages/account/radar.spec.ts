import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Api, GenJob, RadarCluster, RadarView } from '../../core/api';
import { RadarPage, ago, confirmation } from './radar';
import { RaioXPage } from './raio-x';

const now = Date.now();
const iso = (minAgo: number) => new Date(now - minAgo * 60_000).toISOString();

const cluster = (over: Partial<RadarCluster> = {}): RadarCluster => ({
  id: 'c1',
  title: 'Flamengo anuncia reforço',
  summary: 'Resumo',
  items: [{ source: 'ge', title: 'Flamengo anuncia reforço', link: 'https://ge.test/1', published: iso(20) }],
  sources: 3,
  firstAt: iso(90),
  lastAt: iso(20),
  temperature: 'quente',
  kind: 'ultima_hora',
  kindLabel: 'Última hora',
  confirmed: 0.9,
  relevance: 0.9,
  status: 'novo',
  draftId: null,
  jobId: null,
  ...over,
});

const VIEW: RadarView = {
  topic: 'Flamengo',
  feeds: ['ge', 'Google Notícias'],
  lastRefresh: now,
  jev: true,
  clusters: [cluster(), cluster({ id: 'c2', title: 'Clube negocia meia', temperature: 'morna', kind: 'mercado', kindLabel: 'Mercado', confirmed: 0.2 })],
};

const flush = () => new Promise((ok) => setTimeout(ok));
const button = (el: HTMLElement, text: string) =>
  Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes(text)) as HTMLButtonElement;

describe('Radar', () => {
  afterEach(() => vi.useRealTimers());

  it('confirmado, rumor e tempo relativo', () => {
    expect(confirmation(0.9)?.label).toBe('Confirmado');
    expect(confirmation(0.2)?.label).toBe('Rumor');
    expect(confirmation(0.5)?.label).toBe('Incerto');
    expect(confirmation(null)).toBeNull();
    expect(ago(iso(5), now)).toBe('há 5 min');
    expect(ago(iso(180), now)).toBe('há 3 h');
  });

  function setup(api: Record<string, unknown>) {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: Api, useValue: { radar: vi.fn().mockResolvedValue(VIEW), ...api } }],
    });
    const fixture = TestBed.createComponent(RadarPage);
    fixture.componentRef.setInput('id', 'flamengo');
    fixture.detectChanges();
    return fixture;
  }

  it('mostra temperatura, fontes, confirmação e filtra por tipo', async () => {
    const fixture = setup({});
    await flush();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Radar Flamengo');
    expect(el.textContent).toContain('🔥 Quente');
    expect(el.textContent).toContain('3 fonte(s)');
    expect(el.textContent).toContain('Confirmado');
    expect(el.textContent).toContain('Rumor');
    button(el, 'Mercado').click();
    fixture.detectChanges();
    expect(Array.from(el.querySelectorAll('h3')).map((h) => h.textContent)).toEqual(['Clube negocia meia']);
  });

  it('cria o post e mostra o link do rascunho quando termina', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const job: GenJob = { id: 'j1', accountId: 'flamengo', rewrite: true, media: false, done: false, items: [{ theme: 't', kind: 'image', step: 'escrevendo', grades: [], notes: [] }] };
    const done: GenJob = { ...job, done: true, items: [{ ...job.items[0], step: 'pronto', grades: [81], draftId: 9, title: 'Reforço chegou' }] };
    const radar = vi.fn().mockResolvedValueOnce(VIEW).mockResolvedValue({ ...VIEW, clusters: [cluster({ status: 'usado', draftId: 9 })] });
    const radarPost = vi.fn().mockResolvedValue(job);
    const fixture = setup({ radar, radarPost, generateJob: vi.fn().mockResolvedValue(done) });
    await flush();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    button(el, 'Criar post').click();
    await flush();
    expect(radarPost).toHaveBeenCalledWith('flamengo', 'c1', 'image');
    await vi.advanceTimersByTimeAsync(2100);
    fixture.detectChanges();
    expect(el.textContent).toContain('nota do Jev 81');
    expect(el.textContent).toContain('Abrir rascunho');
  });
});

describe('Raio-X', () => {
  it('sugere pautas da série e gera só as marcadas', async () => {
    const generatePautas = vi.fn().mockResolvedValue({ id: 'j', accountId: 'flamengo', rewrite: true, media: false, done: true, items: [] });
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            radarSeries: vi.fn().mockResolvedValue(['Ídolos de todas as épocas']),
            suggestPautas: vi.fn().mockResolvedValue([
              { theme: 'Zico, o Galinho', kind: 'carousel', description: 'trajetória' },
              { theme: 'Júnior, o Maestro', kind: 'image', description: '' },
            ]),
            generatePautas,
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(RaioXPage);
    fixture.componentRef.setInput('id', 'flamengo');
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    button(el, 'Ídolos de todas as épocas').click();
    fixture.detectChanges();
    button(el, 'Sugerir pautas').click();
    await flush();
    fixture.detectChanges();
    expect(el.textContent).toContain('Zico, o Galinho');
    (el.querySelectorAll<HTMLInputElement>('input[type=checkbox]')[1]).click();
    fixture.detectChanges();
    button(el, 'Gerar 1 post(s)').click();
    await flush();
    expect(generatePautas).toHaveBeenCalledWith('flamengo', 'Ídolos de todas as épocas', [{ theme: 'Zico, o Galinho', kind: 'carousel' }]);
  });
});
