// Contas gerenciadas pela tela Contas: adicionar (das contas vinculadas às Páginas do Facebook, ou pelo @),
// renomear, mudar o tipo, remover e editar o perfil (claude.md) que o assistente e o Jev usam.
import fs from 'node:fs';
import path from 'node:path';
import { ACCOUNTS, BUSINESS_TYPES, PROJECT_ROOT, accountFolder, config, findAccount, saveAccounts, type AccountConfig } from './config.ts';
import { read, write } from './store.ts';

export class AccountError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const USERNAME_RE = /^[a-z0-9._]{1,30}$/;
export const PROFILE_MAX = 20_000;

/** "@Minha.Loja" ou link do perfil -> "minha.loja". */
export function normalizeUsername(v: unknown): string {
  return String(v ?? '')
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/[/?#].*$/, '')
    .replace(/^@/, '')
    .toLowerCase();
}

/** Id da aba a partir do @ ("minha.loja" -> "minha-loja"), sem repetir um existente. */
export function newId(username: string, taken: Set<string>): string {
  const base = username.replace(/[._]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '').slice(0, 36) || 'conta';
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

const isBusiness = (v: unknown): v is AccountConfig['business'] => (BUSINESS_TYPES as readonly string[]).includes(String(v));

/** Modelo do perfil (dashboard/exemplo-conta/claude.md), com o link da conta. */
function profileTemplate(username: string): string {
  const file = path.join(PROJECT_ROOT, 'dashboard', 'exemplo-conta', 'claude.md');
  const body = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').slice(1).join('\n') : '\n## Perfil da conta\n- Público:\n- Tom de voz:\n';
  return `https://www.instagram.com/${username}/${body.startsWith('\n') ? '' : '\n'}${body}`;
}

/** Liga a conta ao login do Facebook já feito, se ela estiver entre as vinculadas às Páginas. */
export function connectFromFacebook(accountId: string, username: string): boolean {
  const f = read().facebook;
  const found = f?.available?.find((a) => a.username.toLowerCase() === username);
  if (!f || !found || f.tokenExpiresAt < Date.now()) return false;
  write((d) => {
    d.facebook!.linked[accountId] = found.igUserId;
    const c = d.connections[accountId];
    if (c && !c.via && c.tokenExpiresAt > Date.now()) return; // conexão pelo Instagram ainda vale
    d.connections[accountId] = {
      igUserId: found.igUserId,
      username: found.username,
      tokenEnc: f.tokenEnc,
      tokenIssuedAt: f.tokenIssuedAt,
      tokenExpiresAt: f.tokenExpiresAt,
      permissions: f.permissions,
      via: 'facebook',
    };
  });
  return true;
}

export function addAccount(input: { username?: unknown; label?: unknown; business?: unknown }): { account: AccountConfig; connected: boolean } {
  const username = normalizeUsername(input.username);
  if (!USERNAME_RE.test(username)) throw new AccountError(400, 'Informe o @ da conta (letras, números, ponto e sublinhado).');
  if (ACCOUNTS.some((a) => a.username.toLowerCase() === username)) throw new AccountError(409, `@${username} já está no dashboard.`);
  const business = isBusiness(input.business) ? input.business : 'servicos';
  const label = String(input.label ?? '').trim().slice(0, 60) || `@${username}`;
  const id = newId(username, new Set(ACCOUNTS.map((a) => a.id)));
  // Relativo à raiz (perfis/<id>, fora do Git) ou absoluto quando PROFILES_DIR é definido (testes).
  const folder = config.profilesDir ? path.join(config.profilesDir, id) : `perfis/${id}`;
  const dir = path.resolve(PROJECT_ROOT, folder);
  fs.mkdirSync(dir, { recursive: true });
  const profile = path.join(dir, 'claude.md');
  if (!fs.existsSync(profile)) fs.writeFileSync(profile, profileTemplate(username));
  const account: AccountConfig = { id, label, username, folder, business };
  saveAccounts([...ACCOUNTS, account]);
  return { account, connected: connectFromFacebook(id, username) };
}

export function updateAccount(id: string, input: { label?: unknown; business?: unknown }): AccountConfig {
  const a = findAccount(id);
  if (!a) throw new AccountError(404, 'Conta desconhecida.');
  if (input.business !== undefined && !isBusiness(input.business)) throw new AccountError(400, 'Tipo de negócio inválido.');
  const next = {
    ...a,
    label: input.label !== undefined ? String(input.label).trim().slice(0, 60) || a.label : a.label,
    business: (input.business as AccountConfig['business']) ?? a.business,
  };
  saveAccounts(ACCOUNTS.map((x) => (x.id === id ? next : x)));
  return next;
}

/** Tira do dashboard (e desconecta). Métricas e o perfil ficam guardados, caso a conta volte. */
export function removeAccount(id: string): void {
  if (!findAccount(id)) throw new AccountError(404, 'Conta desconhecida.');
  saveAccounts(ACCOUNTS.filter((a) => a.id !== id));
  write((d) => {
    delete d.connections[id];
    if (d.facebook) delete d.facebook.linked[id];
  });
}

export function readProfile(id: string): string {
  const a = findAccount(id);
  if (!a) throw new AccountError(404, 'Conta desconhecida.');
  const file = path.join(accountFolder(a), 'claude.md');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : profileTemplate(a.username);
}

export function writeProfile(id: string, text: unknown): void {
  const a = findAccount(id);
  if (!a) throw new AccountError(404, 'Conta desconhecida.');
  const body = String(text ?? '');
  if (body.length > PROFILE_MAX) throw new AccountError(400, `O perfil passa de ${PROFILE_MAX} caracteres.`);
  fs.mkdirSync(accountFolder(a), { recursive: true });
  fs.writeFileSync(path.join(accountFolder(a), 'claude.md'), body);
}
