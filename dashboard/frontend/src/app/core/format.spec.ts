import { compact, dateBR, delta, num, pct, shortDay } from './format';

describe('format (pt-BR)', () => {
  it('formata números, percentuais e vazios', () => {
    expect(num(1234567)).toBe('1.234.567');
    expect(num(null)).toBe('—');
    expect(pct(5.25)).toBe('5,3%');
    expect(compact(1500)).toMatch(/1,5\s?mil/);
  });

  it('formata datas', () => {
    expect(dateBR('2026-10-27')).toBe('27/10/2026');
    expect(shortDay('2026-10-07')).toBe('07/10');
  });

  it('calcula variação entre períodos', () => {
    expect(delta(150, 100)).toEqual({ text: '+50%', dir: 'up' });
    expect(delta(50, 100)).toEqual({ text: '-50%', dir: 'down' });
    expect(delta(100, 100)?.dir).toBe('flat');
    expect(delta(10, 0)).toBeNull();
    expect(delta(null, 5)).toBeNull();
  });
});
