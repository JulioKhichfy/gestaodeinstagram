// Tela Contas: começar sem contas, adicionar (com ligação ao login do Facebook), editar, remover e perfil.
import { TMP } from './helpers.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import express from 'express';

// Arquivo de contas próprio deste teste (ainda não existe): o dashboard começa vazio.
process.env.ACCOUNTS_FILE = path.join(TMP, 'contas-teste.json');

const { ACCOUNTS, accountFolder } = await import('../src/config.ts');
const A = await import('../src/accounts.ts');
const { encrypt, read, write } = await import('../src/store.ts');
const { accountAdmin } = await import('../src/routes-accounts.ts');

describe('contas pela tela', () => {
  it('sem arquivo de contas, começa vazio', () => {
    assert.equal(ACCOUNTS.length, 0);
  });

  it('normaliza o @ e cria ids únicos', () => {
    assert.equal(A.normalizeUsername(' @Minha.Loja '), 'minha.loja');
    assert.equal(A.normalizeUsername('https://www.instagram.com/minha.loja/?hl=pt'), 'minha.loja');
    assert.equal(A.newId('minha.loja', new Set()), 'minha-loja');
    assert.equal(A.newId('minha.loja', new Set(['minha-loja'])), 'minha-loja-2');
  });

  it('adiciona, grava o arquivo e cria o perfil a partir do modelo', () => {
    const { account, connected } = A.addAccount({ username: '@Autora.Teste', label: 'Livros', business: 'livros' });
    assert.deepEqual([account.id, account.username, account.business, connected], ['autora-teste', 'autora.teste', 'livros', false]);
    assert.equal(ACCOUNTS.length, 1, 'a lista em memória é atualizada');
    assert.equal(JSON.parse(fs.readFileSync(process.env.ACCOUNTS_FILE!, 'utf8')).length, 1);
    assert.match(fs.readFileSync(path.join(accountFolder(account), 'claude.md'), 'utf8'), /^https:\/\/www\.instagram\.com\/autora\.teste\/\n[\s\S]*Público/);
    assert.throws(() => A.addAccount({ username: 'autora.teste' }), /já está no dashboard/);
    assert.throws(() => A.addAccount({ username: 'nome com espaço' }), /Informe o @/);
  });

  it('conta vinculada a uma Página já entra conectada pelo login do Facebook', () => {
    write((d) => {
      d.facebook = {
        name: 'Pessoa',
        tokenEnc: encrypt('EAA-x'),
        tokenIssuedAt: Date.now(),
        tokenExpiresAt: Date.now() + 86_400_000,
        permissions: ['instagram_basic'],
        linked: {},
        available: [{ igUserId: '1784', username: 'loja.nova', page: 'Loja Nova' }],
      };
    });
    const { account, connected } = A.addAccount({ username: 'loja.nova', business: 'loja' });
    assert.equal(connected, true);
    const c = read().connections[account.id];
    assert.deepEqual([c.igUserId, c.via], ['1784', 'facebook']);
    assert.equal(read().facebook!.linked[account.id], '1784');
  });

  it('edita, perfil com limite e remove (desconectando)', () => {
    assert.equal(A.updateAccount('loja-nova', { label: 'Minha loja', business: 'conteudo' }).business, 'conteudo');
    assert.throws(() => A.updateAccount('loja-nova', { business: 'banco' }), /inválido/);
    A.writeProfile('loja-nova', 'Tom: acolhedor');
    assert.equal(A.readProfile('loja-nova'), 'Tom: acolhedor');
    assert.throws(() => A.writeProfile('loja-nova', 'x'.repeat(A.PROFILE_MAX + 1)), /passa de/);
    A.removeAccount('loja-nova');
    assert.equal(read().connections['loja-nova'], undefined);
    assert.deepEqual(ACCOUNTS.map((a) => a.id), ['autora-teste']);
  });
});

describe('rotas', () => {
  const app = express().use(express.json()).use('/api', accountAdmin);
  const server = app.listen(0);
  let base = '';
  before(async () => {
    await new Promise((ok) => server.once('listening', ok));
    base = `http://localhost:${(server.address() as AddressInfo).port}/api`;
  });
  after(() => server.close());
  const call = (method: string, p: string, body?: unknown) =>
    fetch(base + p, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({
      status: r.status,
      json: r.status === 204 ? null : await r.json(),
    }));

  it('lista as encontradas no Facebook, adiciona com um clique e edita o perfil', async () => {
    const list = await call('GET', '/contas');
    assert.deepEqual(list.json.available.map((a: any) => [a.username, a.added]), [['loja.nova', false]]);
    const created = await call('POST', '/contas', { username: 'loja.nova', business: 'loja' });
    assert.equal(created.status, 201);
    assert.equal(created.json.connected, true);
    assert.equal((await call('GET', '/contas')).json.available[0].added, true);
    assert.equal((await call('PUT', `/contas/${created.json.account.id}/perfil`, { text: 'Perfil novo' })).status, 204);
    assert.equal((await call('GET', `/contas/${created.json.account.id}/perfil`)).json.text, 'Perfil novo');
    assert.equal((await call('POST', '/contas', { username: 'loja.nova' })).status, 409);
    assert.equal((await call('DELETE', '/contas/nao-existe')).status, 404);
  });
});
