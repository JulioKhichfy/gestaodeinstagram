// Assistente pelo ChatGPT (Codex CLI): argumentos, pedido pelo stdin e mensagens de erro.
import './helpers.ts';
import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';

process.env.AI_PROVIDER = 'chatgpt';
process.env.CODEX_BIN = `node "${path.join(import.meta.dirname, 'fixtures', 'bin', 'fake-codex.mjs')}"`;

const { assistantName, completeClaude } = await import('../src/claude.ts');

describe('ChatGPT (Codex)', () => {
  it('usa codex exec só leitura, sem salvar sessão, com o pedido pelo stdin', async () => {
    assert.equal(assistantName(), 'ChatGPT');
    const out = await completeClaude('Sou o sistema', 'Faça a legenda');
    assert.match(out, /^ARGS=exec --skip-git-repo-check --sandbox read-only --ephemeral -$/m);
    assert.match(out, /SISTEMA=true/);
    assert.match(out, /PEDIDO=true/);
    assert.doesNotMatch(out, /progresso/, 'o que sai no stderr não entra na resposta');
  });

  it('sem login, explica como entrar com o ChatGPT', async () => {
    await assert.rejects(completeClaude('s', 'FALHA_LOGIN'), /Sign in with ChatGPT/);
  });
});
