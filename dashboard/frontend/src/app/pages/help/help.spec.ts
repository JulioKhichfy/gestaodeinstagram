import { TestBed } from '@angular/core/testing';
import { HELP } from './help-content';
import { HelpPage } from './help';

describe('HelpPage', () => {
  it('lista todas as seções, incluindo algoritmo e tráfego pago', () => {
    const fixture = TestBed.createComponent(HelpPage);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('section').length).toBe(HELP.length);
    expect(el.querySelector('#algoritmo')).not.toBeNull();
    expect(el.querySelector('#trafego')).not.toBeNull();
  });

  it('busca ignora acentos e maiúsculas', () => {
    const fixture = TestBed.createComponent(HelpPage);
    const page = fixture.componentInstance as unknown as { query: { set(v: string): void } };
    page.query.set('IMPULSIONAR');
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent!;
    expect(text).toContain('Quando vale impulsionar?');
    expect(text).not.toContain('Glossário de métricas');

    page.query.set('xyz-nao-existe');
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Nada encontrado');
  });

  it('agrupa linhas "- " em listas', () => {
    const page = TestBed.createComponent(HelpPage).componentInstance as unknown as {
      blocks(l: string[]): { list: boolean; lines: string[] }[];
    };
    expect(page.blocks(['Intro', '- a', '- b', 'Fim'])).toEqual([
      { list: false, lines: ['Intro'] },
      { list: true, lines: ['a', 'b'] },
      { list: false, lines: ['Fim'] },
    ]);
  });
});
