import { TestBed } from '@angular/core/testing';
import { Api } from '../core/api';
import { ClaudePanel } from './claude-panel';

describe('ClaudePanel', () => {
  const askClaude = vi.fn();

  beforeEach(() => askClaude.mockReset());

  function setup(inputs: Record<string, unknown> = {}, ask: (...args: unknown[]) => Promise<unknown> = askClaude) {
    TestBed.configureTestingModule({
      providers: [{ provide: Api, useValue: { askClaude: ask, draftMessages: vi.fn().mockResolvedValue([]) } }],
    });
    const fixture = TestBed.createComponent(ClaudePanel);
    fixture.componentRef.setInput('accountId', 'loja');
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
    return fixture;
  }

  it('envia conta, tipo de artefato e texto atual, e emite o texto escolhido', async () => {
    askClaude.mockResolvedValue({ text: 'Legenda nova' });
    const fixture = setup({ currentText: 'rascunho', artifacts: ['legenda', 'hashtags'] });
    const used: unknown[] = [];
    fixture.componentInstance.use.subscribe((v) => used.push(v));

    await fixture.componentInstance.ask();
    fixture.detectChanges();

    expect(askClaude).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'loja', artifact: 'legenda', currentText: 'rascunho' }),
    );
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Legenda nova');
    (Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('Usar este texto')) as HTMLButtonElement).click();
    expect(used).toEqual([{ text: 'Legenda nova', mode: 'replace' }]);
  });

  it('pedido livre exige instrução', async () => {
    const fixture = setup({ artifacts: ['livre'] });
    await fixture.componentInstance.ask();
    fixture.detectChanges();
    expect(askClaude).not.toHaveBeenCalled();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Escreva o que você quer pedir');
  });

  it('mostra o erro do backend', async () => {
    // Função simples (não vi.fn): o rastreador do vi.fn reporta a rejeição mesmo quando o componente a trata.
    const fixture = setup({}, () => Promise.reject({ error: { error: 'Claude Code não está logado.' } }));
    await fixture.componentInstance.ask();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Claude Code não está logado.');
  });
});
