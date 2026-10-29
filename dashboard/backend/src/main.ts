// Ponto de entrada: sobe o servidor e as tarefas periódicas.
import { ACCOUNTS, config, fbRedirectUri, missingConfig, publishMissing, redirectUri, setupMissing } from './config.ts';
import * as ig from './instagram.ts';
import { app } from './server.ts';
import { connectionToken, encrypt, read, write } from './store.ts';
import { db } from './db.ts';
import { jevClient, jevConfigured } from './jev.ts';
import { refreshRadar } from './radar.ts';
import { publishFor, recoverStuck, runDue } from './schedule.ts';
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

// Radar de assuntos: notícia quente envelhece rápido, então lê as fontes a cada 10 min (só contas com radar).
const RADAR_EVERY = 10 * 60 * 1000;
function radarTick(): void {
  for (const a of ACCOUNTS.filter((x) => x.radar)) {
    refreshRadar(db, a, jevConfigured() ? jevClient : null).catch((e) => console.error(`radar ${a.id}:`, (e as Error).message));
  }
}

// Agenda: a cada minuto publica o que venceu (precisa do túnel ligado no horário).
let scheduling = false;
async function scheduleTick(): Promise<void> {
  if (scheduling) return;
  scheduling = true;
  try {
    await runDue(db, (accountId, req) => publishFor(db, accountId, req));
  } catch (e) {
    console.error('agenda:', (e as Error).message);
  } finally {
    scheduling = false;
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
  radarTick();
  setInterval(radarTick, RADAR_EVERY);
  recoverStuck(db);
  setInterval(scheduleTick, 60 * 1000);
  setInterval(() => housekeeping().catch((e) => console.error('housekeeping:', e)), 6 * 60 * 60 * 1000);
});
