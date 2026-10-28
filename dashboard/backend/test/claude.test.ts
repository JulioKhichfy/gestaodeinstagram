import './helpers.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const { openDb } = await import('../src/db.ts');
const { findAccount } = await import('../src/config.ts');
const { buildSystemPrompt, buildUserPrompt } = await import('../src/claude.ts');

const account = findAccount('loja')!;

describe('prompt do Claude', () => {
  it('inclui o claude.md da conta e o aviso quando não há métricas', () => {
    const sys = buildSystemPrompt(openDb(':memory:'), { account, artifact: 'legenda', instruction: '' });
    assert.match(sys, /@loja.exemplo/);
    assert.match(sys, /É UMA LOJA/); // vem de test/fixtures/contas/loja/claude.md
    assert.match(sys, /Ainda não há métricas/);
  });

  it('monta tarefa, texto atual, pedido e histórico', () => {
    const p = buildUserPrompt({
      account,
      artifact: 'hashtags',
      instruction: 'foco em presentes de Natal',
      currentText: 'Kit aromático',
      history: [
        { role: 'user', content: 'primeira versão' },
        { role: 'assistant', content: 'resposta' },
      ],
    });
    assert.match(p, /Usuária: primeira versão/);
    assert.match(p, /Você: resposta/);
    assert.match(p, /hashtags/);
    assert.match(p, /Kit aromático/);
    assert.match(p, /presentes de Natal/);
  });
});
