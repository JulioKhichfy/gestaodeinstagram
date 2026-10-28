import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';

/** Conexão de uma conta. O token fica criptografado em disco. */
export interface Connection {
  igUserId: string;
  username: string;
  tokenEnc: string;
  tokenIssuedAt: number;
  tokenExpiresAt: number;
  /** Permissões concedidas no OAuth (conexões da v1 não têm este campo). */
  permissions?: string[];
}

/**
 * Conexão do login do Facebook (uma por dashboard), usada só pela Descoberta.
 * `linked` liga o id interno de cada conta ao id da conta do Instagram vinculada a uma Página.
 */
export interface FacebookConnection {
  name: string;
  tokenEnc: string;
  tokenIssuedAt: number;
  tokenExpiresAt: number;
  permissions: string[];
  linked: Record<string, string>;
}

interface Session {
  tokenHash: string;
  expiresAt: number;
}

interface StoreData {
  passwordHash?: string;
  sessions: Session[];
  connections: Record<string, Connection>;
  facebook?: FacebookConnection;
}

const storeFile = path.join(config.dataDir, 'store.json');
const keyFile = path.join(config.dataDir, 'secret.key');

fs.mkdirSync(config.dataDir, { recursive: true });

// Chave de criptografia gerada no primeiro uso e mantida só neste PC.
if (!fs.existsSync(keyFile)) {
  fs.writeFileSync(keyFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
}
const key = Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'hex');

let data: StoreData = fs.existsSync(storeFile)
  ? JSON.parse(fs.readFileSync(storeFile, 'utf8'))
  : { sessions: [], connections: {} };

export function read(): StoreData {
  return data;
}

export function write(mutate: (d: StoreData) => void): void {
  mutate(data);
  const tmp = `${storeFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, storeFile);
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}

export function decrypt(payload: string): string {
  const [iv, tag, enc] = payload.split('.').map((s) => Buffer.from(s, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

export function connectionToken(accountId: string): string | undefined {
  const c = data.connections[accountId];
  return c ? decrypt(c.tokenEnc) : undefined;
}

export function facebookToken(): string | undefined {
  const f = data.facebook;
  return f && f.tokenExpiresAt > Date.now() ? decrypt(f.tokenEnc) : undefined;
}
