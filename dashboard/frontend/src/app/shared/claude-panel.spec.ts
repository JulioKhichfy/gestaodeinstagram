import { TestBed } from '@angular/core/testing';
import { Api } from '../core/api';
import { ClaudePanel, applyClaudeText, listOptions, onlyHashtags } from './claude-panel';

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

  it('ganchos: cada opção troca só a 1ª linha', async () => {
    askClaude.mockResolvedValue({ text: '1. Você sabia?\n2. "Pare de errar nisso"\n3. 5 dicas rápidas' });
    const fixture = setup({ artifacts: ['ganchos'] });
    const used: unknown[] = [];
    fixture.componentInstance.use.subscribe((v) => used.push(v));
    await fixture.componentInstance.ask();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const buttons = Array.from(el.querySelectorAll('button')).filter((b) => b.textContent?.includes('Usar como 1ª linha'));
    expect(buttons.length).toBe(3);
    expect(el.textContent).not.toContain('Usar este texto');
    buttons[1].click();
    expect(used).toEqual([{ text: 'Pare de errar nisso', mode: 'firstLine' }]);
  });

  it('avisa quando a legenda passa do limite e pede versão mais curta', async () => {
    askClaude.mockResolvedValueOnce({ text: 'x'.repeat(2300) }).mockResolvedValueOnce({ text: 'curta' });
    const fixture = setup({ artifacts: ['legenda'] });
    await fixture.componentInstance.ask();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('passa do limite de 2200');
    await fixture.componentInstance.shorten();
    fixture.detectChanges();
    expect(askClaude).toHaveBeenLastCalledWith(expect.objectContaining({ artifact: 'melhorar', currentText: 'x'.repeat(2300) }));
    expect(el.textContent).not.toContain('passa do limite');
  });

  it('aplica a resposta no texto e extrai opções e hashtags', () => {
    expect(applyClaudeText('Linha 1\nResto', { text: 'Novo gancho', mode: 'firstLine' })).toBe('Novo gancho\nResto');
    expect(applyClaudeText('Texto', { text: '#a', mode: 'append' })).toBe('Texto\n\n#a');
    expect(applyClaudeText('', { text: 'Novo', mode: 'firstLine' })).toBe('Novo');
    expect(listOptions('Ideias:\n1) Um\n- Dois\ntexto solto')).toEqual(['Um', 'Dois']);
    expect(onlyHashtags('#decoração #casa\nPalavras-chave: sala')).toBe('#decoração #casa');
  });
});
