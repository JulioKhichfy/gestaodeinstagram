// Conexão das contas pelo login do Facebook: OAuth -> contas vinculadas a Páginas -> API em graph.facebook.com.
import './helpers.ts';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

process.env.FB_APP_ID = '123';
process.env.FB_APP_SECRET = 'segredo';

// Meta falsa: responde só às URLs da Graph API; o resto (o próprio servidor) segue para o fetch real.
const realFetch = globalThis.fetch;
const metaCalls: string[] = [];
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!/graph\.(facebook|instagram)\.com/.test(url)) return realFetch(input, init);
  metaCalls.push(`${init?.method ?? 'GET'} ${url}`);
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const u = new URL(url);
  if (u.pathname.endsWith('/oauth/access_token')) return json({ access_token: 'EAA-token', expires_in: 5_184_000 });
  if (u.pathname.endsWith('/me/permissions')) return json({ data: [{ permission: 'instagram_manage_insights', status: 'granted' }, { permission: 'instagram_content_publish', status: 'granted' }] });
  if (u.pathname.endsWith('/me/accounts')) return json({ data: [{ instagram_business_account: { id: '1784', username: 'Loja.Exemplo' } }, { name: "Página sem Instagram" }] });
  if (u.pathname.endsWith('/me')) return json({ name: 'Pessoa Teste' });
  if (u.pathname.endsWith('/1784') && u.searchParams.get('fields')?.includes('followers_count')) {
    return json({ id: '1784', username: 'loja.exemplo', followers_count: 321, media_count: 2 });
  }
  return json({ data: [] });
}) as typeof fetch;
after(() => {
  globalThis.fetch = realFetch;
});

const { app } = await import('../src/server.ts');
const ig = await import('../src/instagram.ts');
const { fbAuthorizeUrl } = await import('../src/facebook.ts');

let base = '';
let token = '';
const server = app.listen(0);
before(async () => {
  await new Promise((ok) => server.once('listening', ok));
  base = `http://localhost:${(server.address() as AddressInfo).port}/api`;
  token = (await (await realFetch(`${base}/session/setup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'senha-de-teste' }) })).json()).token;
});
after(() => server.close());

const api = (path: string, init: RequestInit = {}) =>
  realFetch(base + path, { redirect: 'manual', ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...init.headers } });

describe('conexão pelo login do Facebook', () => {
  it('pede a permissão de publicar no login', () => {
    const url = new URL(fbAuthorizeUrl('x'));
    assert.match(url.searchParams.get('scope')!, /instagram_content_publish/);
    assert.equal(url.searchParams.get('config_id'), null);
  });

  it('conecta a conta vinculada e volta para a página dela', async () => {
    const { url } = await (await api('/facebook/connect', { method: 'POST', body: JSON.stringify({ accountId: 'loja', returnTo: 'conta' }) })).json();
    const state = new URL(url).searchParams.get('state')!;
    const res = await api(`/facebook/callback?code=abc&state=${state}`);
    assert.equal(res.status, 302);
    assert.match(res.headers.get('location')!, /\/conta\/loja\?connected=1$/);

    const accounts = await (await api('/accounts')).json();
    const loja = accounts.find((a: any) => a.id === 'loja');
    assert.deepEqual([loja.connected, loja.via, loja.hasInsights], [true, 'facebook', true]);
    assert.equal(accounts.find((a: any) => a.id === 'autora').connected, false, 'contas sem Página continuam desconectadas');
    assert.doesNotMatch(JSON.stringify(accounts), /EAA-token/);
  });

  it('perfil e métricas vão para graph.facebook.com com o id da conta', async () => {
    metaCalls.length = 0;
    const r = await (await api('/accounts/loja/overview')).json();
    assert.equal(r.profile.user_id, '1784');
    assert.equal(r.profile.followers_count, 321);
    assert.ok(metaCalls.length > 0 && metaCalls.every((c) => c.includes('graph.facebook.com/')), metaCalls.join('\n'));
    assert.ok(!metaCalls.some((c) => /\/me\?/.test(c)), 'no login do Facebook o perfil não vem de /me');
  });

  it('avisa quando a conta da aba não está vinculada a uma Página', async () => {
    const { url } = await (await api('/facebook/connect', { method: 'POST', body: JSON.stringify({ accountId: 'autora', returnTo: 'conta' }) })).json();
    const res = await api(`/facebook/callback?code=abc&state=${new URL(url).searchParams.get('state')}`);
    const location = decodeURIComponent(res.headers.get('location')!.replace(/\+/g, ' '));
    assert.match(location, /\/conta\/autora\?error=.*não apareceu vinculada.*@Loja\.Exemplo/);
    assert.match(location, /Páginas sem Instagram vinculado: Página sem Instagram/);
  });

  it('desconectar o Facebook desliga as contas conectadas por ele', async () => {
    assert.equal((await api('/facebook/connection', { method: 'DELETE' })).status, 204);
    const accounts = await (await api('/accounts')).json();
    assert.equal(accounts.find((a: any) => a.id === 'loja').connected, false);
  });

  it('publicação usa o servidor da credencial', async () => {
    metaCalls.length = 0;
    await ig.createContainer('1784', { token: 't', via: 'facebook' }, { caption: 'oi' });
    await ig.createContainer('1784', { token: 't', via: 'instagram' }, { caption: 'oi' });
    assert.match(metaCalls[0], /^POST https:\/\/graph\.facebook\.com\/v[\d.]+\/1784\/media$/);
    assert.match(metaCalls[1], /^POST https:\/\/graph\.instagram\.com\/v[\d.]+\/1784\/media$/);
  });
});
