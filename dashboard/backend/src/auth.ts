import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { read, write } from './store.ts';

const HOUR = 60 * 60 * 1000;
const SHORT_SESSION = 12 * HOUR;
const LONG_SESSION = 30 * 24 * HOUR;

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':').map((s) => Buffer.from(s, 'hex'));
  return crypto.timingSafeEqual(crypto.scryptSync(password, salt, 64), hash);
}

export const hasPassword = () => Boolean(read().passwordHash);

export function setPassword(password: string): void {
  write((d) => {
    d.passwordHash = hashPassword(password);
    d.sessions = [];
  });
}

export function checkPassword(password: string): boolean {
  const stored = read().passwordHash;
  return Boolean(stored) && verifyPassword(password, stored!);
}

export function createSession(remember: boolean): { token: string; expiresAt: number } {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + (remember ? LONG_SESSION : SHORT_SESSION);
  write((d) => {
    d.sessions = d.sessions.filter((s) => s.expiresAt > Date.now());
    d.sessions.push({ tokenHash: sha256(token), expiresAt });
  });
  return { token, expiresAt };
}

export function destroySession(token: string): void {
  write((d) => {
    d.sessions = d.sessions.filter((s) => s.tokenHash !== sha256(token));
  });
}

function bearer(req: Request): string | undefined {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7) : undefined;
}

export function requireSession(req: Request, res: Response, next: NextFunction): void {
  const token = bearer(req);
  const valid = token && read().sessions.some((s) => s.tokenHash === sha256(token) && s.expiresAt > Date.now());
  if (!valid) {
    res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });
    return;
  }
  next();
}

export { bearer };

// Freio simples contra tentativa de senha por força bruta (a API fica exposta pelo túnel).
const failures = new Map<string, { count: number; until: number }>();

export function loginBlocked(ip: string): boolean {
  const f = failures.get(ip);
  return Boolean(f && f.count >= 5 && f.until > Date.now());
}

export function registerLoginFailure(ip: string): void {
  const f = failures.get(ip);
  const count = f && f.until > Date.now() ? f.count + 1 : 1;
  failures.set(ip, { count, until: Date.now() + 15 * 60 * 1000 });
}

export function clearLoginFailures(ip: string): void {
  failures.delete(ip);
}
