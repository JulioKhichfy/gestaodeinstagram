import { TestBed } from '@angular/core/testing';
import { Api, StudioCaps, StudioPlanView } from '../../core/api';
import { Assistant } from '../../core/assistant';
import { RECIPES, StudioPage, commandLine } from './studio';

const CAPS: StudioCaps = { ffmpeg: 'ffmpeg version 8.0', whisper: false, subtitles: true, drawtext: true, models: [], download: { base: null, small: null } };
const PLAN: StudioPlanView = {
  id: 'p1',
  outDir: 'C:\\videos\\editados',
  problems: [],
  plan: {
    resumo: 'Reels vertical',
    passos: [{ descricao: 'Vertical 9:16', tipo: 'ffmpeg', args: ['-i', 'C:\\videos\\a b.mp4', 'reels.mp4'] }],
    avisos: [],
    kdenlive: 'Ajuste fino na faixa de legendas',
  },
};

const flush = () => new Promise((ok) => setTimeout(ok));
const button = (el: HTMLElement, text: string) =>
  Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes(text)) as HTMLButtonElement;

describe('Estúdio', () => {
  function setup(api: Record<string, unknown>, caps: StudioCaps = CAPS) {
    TestBed.configureTestingModule({
      providers: [
        { provide: Assistant, useValue: { name: () => 'Claude' } },
        { provide: Api, useValue: { studioCaps: vi.fn().mockResolvedValue(caps), ...api } },
      ],
    });
    const fixture = TestBed.createComponent(StudioPage);
    fixture.detectChanges();
    return fixture;
  }

  it('carrega a pasta, planeja com os arquivos marcados e mostra o plano antes de executar', async () => {
    const studioFiles = vi.fn().mockResolvedValue({
      files: [{ path: 'C:\\videos\\a b.mp4', name: 'a b.mp4', kind: 'video', size: 2_097_152, duration: 12, width: 1920, height: 1080 }],
      errors: [],
    });
    const studioPlan = vi.fn().mockResolvedValue(PLAN);
    const studioRun = vi.fn();
    const fixture = setup({ studioFiles, studioPlan, studioRun });
    await flush();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('FFmpeg: ffmpeg version 8.0');
    expect(el.textContent).not.toContain('Legendas automáticas');
    expect(el.textContent).toContain('Legendas (o mais importante');

    const [paths, request] = Array.from(el.querySelectorAll('textarea'));
    paths.value = 'C:\\videos';
    paths.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    button(el, 'Carregar arquivos').click();
    await flush();
    fixture.detectChanges();
    expect(studioFiles).toHaveBeenCalledWith(['C:\\videos']);
    expect(el.textContent).toContain('1920x1080');

    button(el, 'Reels vertical').click();
    fixture.detectChanges();
    expect(request.value).toContain('1080x1920');
    button(el, 'Planejar edição').click();
    await flush();
    fixture.detectChanges();
    expect(studioPlan).toHaveBeenCalledWith(['C:\\videos\\a b.mp4'], RECIPES[0].prompt);
    expect(el.textContent).toContain('Reels vertical');
    expect(el.textContent).toContain('No Kdenlive:');
    expect(studioRun).not.toHaveBeenCalled();
    expect(button(el, 'Executar').disabled).toBe(false);
  });

  it('sem FFmpeg mostra como instalar e não deixa planejar', async () => {
    const fixture = setup({}, { ...CAPS, ffmpeg: null });
    await flush();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('winget install -e --id Gyan.FFmpeg');
    expect(button(el, 'Planejar edição').disabled).toBe(true);
  });

  it('mostra o comando com aspas onde tem espaço', () => {
    expect(commandLine(['-i', 'C:\\a b.mp4', 'out.mp4'])).toBe('ffmpeg -i "C:\\a b.mp4" out.mp4');
  });
});
