// Ponto de entrada: sobe o servidor e as tarefas periódicas.
import { config, fbRedirectUri, missingConfig, publishMissing, redirectUri, setupMissing } from './config.ts';
import * as ig from './instagram.ts';
import { app } from './server.ts';
import { connectionToken, encrypt, read, write } from './store.ts';
import { syncAll } from './sync.ts';

const DAY = 24 * 60 * 60 * 1000;

// ---------- Renovação automática dos tokens ("manter conectado") ----------

async function refreshTokens(): Promise<void> {
  for (const [accountId, c] of Object.entries(read().connections)) {
    const age = Date.now() - c.tokenIssuedAt;
    // Tokens do login do Facebook não têm renovação pelo servidor: o painel avisa para entrar de novo.
    if (c.via === 'facebook' || c.tokenExpiresAt < Date.now() || age < 7 * DAY) continue;
    try {
      const { token, expiresIn } = await ig.refreshToken(connectionToken(accountId)!);
      write((d) => {
        d.connections[accountId] = {
          ...c,
          tokenEnc: encrypt(token),
          tokenIssuedAt: Date.now(),
          tokenExpiresAt: Date.now() + expiresIn * 1000,
        };
      });
      console.log(`Token renovado: @${c.username}`);
    } catch (e) {
      console.error(`Falha ao renovar token de @${c.username}:`, (e as Error).message);
    }
  }
}

// A cada 6h: renova tokens e sincroniza métricas de todas as contas.
async function housekeeping(): Promise<void> {
  await refreshTokens();
  await syncAll();
}

app.listen(config.port, () => {
  console.log(`Backend em http://localhost:${config.port}`);
  const missing = setupMissing();
  if (missing.length) console.warn(`Falta configurar no .env: ${missing.join(', ')}`);
  if (publishMissing()) console.warn(`Publicar desligado: falta ${publishMissing()}`);
  if (!missingConfig().length) console.log(`Redirect URI do login do Instagram: ${redirectUri()}`);
  if (config.fbAppId) console.log(`Redirect URI do login do Facebook: ${fbRedirectUri()}`);
  housekeeping().catch((e) => console.error('housekeeping:', e));
  setInterval(() => housekeeping().catch((e) => console.error('housekeeping:', e)), 6 * 60 * 60 * 1000);
});
