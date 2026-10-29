import { TestBed } from '@angular/core/testing';
import { Api, Lead, LeadStats } from '../../core/api';
import { LeadsPage } from './leads';

const LEAD: Lead = {
  id: 'c1',
  username: 'ana',
  text: 'Quanto custa o kit?',
  timestamp: '2026-10-21T10:00:00Z',
  likeCount: 1,
  intent: 'compra',
  intentLabel: 'Quer comprar ou contratar',
  intentConfidence: 0.9,
  interest: 0.95,
  urgent: 0.8,
  status: 'novo',
  notes: '',
  dealValue: null,
  repliedAt: null,
  replyText: null,
  media: { id: 'm1', permalink: 'https://instagram.com/p/m1', thumbnail: null, caption: 'Kit inverno' },
};

const STATS: LeadStats = {
  days: 30, comments: 4, leads: 2, pending: 1, novo: 2, emConversa: 0, clientes: 0, descartados: 0, valor: 0, conversao: 0, topPosts: [],
};

describe('LeadsPage', () => {
  afterEach(() => vi.restoreAllMocks());

  function setup(api: Record<string, unknown>) {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: Api,
          useValue: {
            leadsStatus: vi.fn().mockResolvedValue({ connected: true, hasPermission: true, via: 'facebook', jev: true }),
            leadStats: vi.fn().mockResolvedValue(STATS),
            leads: vi.fn().mockResolvedValue([LEAD]),
            ...api,
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(LeadsPage);
    fixture.componentRef.setInput('id', 'loja');
    fixture.detectChanges();
    return fixture;
  }

  const flush = () => new Promise((ok) => setTimeout(ok));
  const button = (el: HTMLElement, text: string) =>
    Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes(text)) as HTMLButtonElement;

  it('mostra o interessado com intenção, interesse, urgência e o link do direct', async () => {
    const fixture = setup({});
    await flush();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('@ana');
    expect(el.textContent).toContain('Quer comprar ou contratar');
    expect(el.textContent).toContain('Interesse 95%');
    expect(el.textContent).toContain('Urgente');
    expect(el.querySelector<HTMLAnchorElement>('a[href="https://ig.me/m/ana"]')).toBeTruthy();
  });

  it('pede para reconectar quando falta a permissão de comentários', async () => {
    const fixture = setup({ leadsStatus: vi.fn().mockResolvedValue({ connected: true, hasPermission: false, via: 'facebook', jev: true }) });
    await flush();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Falta uma permissão');
    expect(button(el, 'Buscar comentários agora').disabled).toBe(true);
  });

  it('sugere com o Claude, confirma e responde', async () => {
    const suggestReply = vi.fn().mockResolvedValue({ text: 'Oi Ana! Te chamei no direct 💛' });
    const replyLead = vi.fn().mockResolvedValue({ ...LEAD, status: 'em_conversa', repliedAt: '2026-10-29T10:00:00Z' });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const fixture = setup({ suggestReply, replyLead });
    await flush();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    button(el, 'Responder').click();
    fixture.detectChanges();
    button(el, 'Sugerir com o Claude').click();
    await flush();
    fixture.detectChanges();
    expect(el.querySelector('textarea')!.value).toBe('Oi Ana! Te chamei no direct 💛');

    button(el, 'Responder no Instagram').click();
    await flush();
    fixture.detectChanges();
    expect(replyLead).toHaveBeenCalledWith('c1', 'Oi Ana! Te chamei no direct 💛');
    expect(el.textContent).toContain('Respondido');
  });
});
