import { TestBed } from '@angular/core/testing';
import { Kpi } from './kpi';

function render(inputs: Record<string, unknown>) {
  const fixture = TestBed.createComponent(Kpi);
  for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('Kpi', () => {
  it('mostra valor e alta como positiva', () => {
    const el = render({ label: 'Alcance', value: '1,2 mil', current: 120, previous: 100 });
    expect(el.textContent).toContain('1,2 mil');
    expect(el.querySelector('.delta')!.classList).toContain('good');
    expect(el.textContent).toContain('+20%');
  });

  it('com inverse, alta é negativa', () => {
    const el = render({ label: 'Dias sem postar', value: '5', current: 5, previous: 2, inverse: true });
    expect(el.querySelector('.delta')!.classList).toContain('bad');
  });

  it('sem comparação mostra a nota', () => {
    const el = render({ label: 'Seguidores', value: '900', note: '+10 no período' });
    expect(el.textContent).toContain('+10 no período');
  });
});
