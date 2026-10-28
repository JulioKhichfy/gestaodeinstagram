import { TestBed } from '@angular/core/testing';
import { Api, CaptionReview } from '../core/api';
import { JevReview, gradeLabel } from './jev-review';

const REVIEW: CaptionReview = {
  grade: 62,
  dimensions: [
    { key: 'gancho', label: 'Gancho', value: 0.33, weight: 35, level: 'Previsível', confidence: 0.4, uncertain: true },
    { key: 'cta', label: 'Chamada para ação', value: 0.9, weight: 20, level: 'Tem', confidence: null, uncertain: false },
  ],
  objective: { value: 'venda', label: 'Venda', confidence: 0.8, uncertain: false },
  hook: { value: 'Pergunta', label: 'Pergunta', confidence: 0.7, uncertain: false },
  style: null,
  risk: 0.1,
  tips: ['Fortaleça a 1ª linha.'],
  warnings: ['Revise antes de publicar.'],
  toneEvaluated: false,
};

describe('JevReview', () => {
  function setup(api: Partial<Record<keyof Api, unknown>>, inputs: Record<string, unknown> = {}) {
    TestBed.configureTestingModule({ providers: [{ provide: Api, useValue: api }] });
    const fixture = TestBed.createComponent(JevReview);
    fixture.componentRef.setInput('accountId', 'loja');
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
    return fixture;
  }

  it('faixas da nota', () => {
    expect(gradeLabel(80)).toBe('Pronta para publicar');
    expect(gradeLabel(50)).toBe('Dá para melhorar');
    expect(gradeLabel(49)).toBe('Precisa de ajustes');
  });

  it('envia legenda e formato, mostra nota, dúvida, alertas e emite gancho/estilo', async () => {
    const reviewCaption = vi.fn().mockResolvedValue(REVIEW);
    const fixture = setup(
      { jevStatus: vi.fn().mockResolvedValue({ configured: true }), reviewCaption },
      { caption: 'Você sabia?', kind: 'carousel', offerTags: true },
    );
    const tags: unknown[] = [];
    fixture.componentInstance.tags.subscribe((t) => tags.push(t));

    await fixture.componentInstance.review();
    fixture.detectChanges();

    expect(reviewCaption).toHaveBeenCalledWith('loja', { caption: 'Você sabia?', kind: 'carousel' });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('62');
    expect(el.textContent).toContain('Dá para melhorar');
    expect(el.textContent).toContain('Jev em dúvida');
    expect(el.textContent).toContain('Revise antes de publicar.');
    expect(el.textContent).toContain('Tom da marca não avaliado');
    (Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('Usar gancho')) as HTMLButtonElement).click();
    expect(tags).toEqual([{ hook: 'Pergunta', style: null }]);

    fixture.componentRef.setInput('caption', 'Outro texto');
    fixture.detectChanges();
    expect(el.textContent).toContain('O texto mudou desde a última revisão');
  });

  it('avisa quando o Jev está desligado', async () => {
    const fixture = setup({ jevStatus: vi.fn().mockResolvedValue({ configured: false }), reviewCaption: vi.fn() });
    await new Promise((ok) => setTimeout(ok));
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('TYPESAFE_API_KEY');
    expect(el.querySelector('button')).toBeNull();
  });
});
