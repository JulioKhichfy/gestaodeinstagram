import fs from 'node:fs';
import path from 'node:path';

export const BUSINESS_TYPES = ['livros', 'servicos', 'loja'] as const;

export interface AdRecommendation {
  objective: string;
  audience: string;
  budget: string;
  tip: string;
}

export interface AccountConfig {
  id: string;
  label: string;
  /** Username esperado no Instagram; o callback do OAuth rejeita outra conta. */
  username: string;
  /** Pasta com o claude.md da conta, relativa à raiz do projeto (ou caminho absoluto). */
  folder: string;
  /** Tipo de negócio: orienta as recomendações de tráfego pago e o Claude. */
  business: (typeof BUSINESS_TYPES)[number];
  /** Recomendação de tráfego pago específica da conta (sobrepõe a padrão do tipo de negócio). */
  ads?: Partial<AdRecommendation>;
}

/** Raiz do projeto (onde ficam as pastas das contas). */
export const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

// As contas ficam em backend/accounts.json, que é local e fica fora do Git (dados de clientes).
// Sem ele, o dashboard sobe com o exemplo (accounts.example.json). ACCOUNTS_FILE troca o arquivo
// (testes, ou uma conta de teste no .env); caminho relativo à pasta backend.
const accountsFile =
  (process.env.ACCOUNTS_FILE ? path.resolve(import.meta.dirname, '..', process.env.ACCOUNTS_FILE) : undefined) ??
  [path.resolve(import.meta.dirname, '..', 'accounts.json'), path.resolve(import.meta.dirname, '..', 'accounts.example.json')].find((f) =>
    fs.existsSync(f),
  )!;

function loadAccounts(file: string): AccountConfig[] {
  const list = JSON.parse(fs.readFileSync(file, 'utf8')) as AccountConfig[];
  if (!Array.isArray(list) || !list.length) throw new Error(`${file}: informe ao menos uma conta.`);
  for (const a of list) {
    if (!/^[a-z0-9-]{1,40}$/.test(a.id ?? '')) throw new Error(`${file}: id inválido "${a.id}" (use letras minúsculas, números e hífen).`);
    if (!a.username || !a.label || !a.folder) throw new Error(`${file}: a conta "${a.id}" precisa de label, username e folder.`);
    if (!BUSINESS_TYPES.includes(a.business)) throw new Error(`${file}: business da conta "${a.id}" deve ser ${BUSINESS_TYPES.join(', ')}.`);
  }
  return list;
}

export const ACCOUNTS: AccountConfig[] = loadAccounts(accountsFile);

export const accountFolder = (a: AccountConfig) => path.resolve(PROJECT_ROOT, a.folder);

export function findAccount(id: string): AccountConfig | undefined {
  return ACCOUNTS.find((a) => a.id === id);
}

const env = process.env;

export const config = {
  port: Number(env.PORT ?? 3000),
  igAppId: env.IG_APP_ID ?? '',
  igAppSecret: env.IG_APP_SECRET ?? '',
  publicBaseUrl: (env.PUBLIC_BASE_URL ?? '').replace(/\/+$/, ''),
  frontendUrl: (env.FRONTEND_URL ?? 'http://localhost:4300').replace(/\/+$/, ''),
  graphVersion: env.GRAPH_API_VERSION ?? 'v23.0',
  /** App da Meta (Configurações > Básico): usado só pela Descoberta, via login do Facebook. */
  fbAppId: env.FB_APP_ID ?? '',
  fbAppSecret: env.FB_APP_SECRET ?? '',
  /** Login do Facebook para Empresas: id da configuração (com as permissões) criada no painel da Meta. */
  fbConfigId: env.FB_CONFIG_ID ?? '',
  /** Base do retorno do login do Facebook. Em modo Desenvolvimento a Meta aceita localhost. */
  fbRedirectBase: (env.FB_REDIRECT_BASE ?? '').replace(/\/+$/, ''),
  /** Executável do Claude Code (usa a assinatura logada no PC). */
  claudeBin: env.CLAUDE_BIN ?? 'claude',
  /** Modelo opcional para o Claude Code; vazio = padrão da sua assinatura. */
  claudeModel: env.CLAUDE_MODEL ?? '',
  /** Jev (TypeSafe AI): avaliações rápidas e tipadas. Sem chave, as funções do Jev ficam desligadas. */
  typesafeApiKey: env.TYPESAFE_API_KEY ?? '',
  jevModel: env.JEV_MODEL || 'jev-latest',
  jevBaseUrl: (env.JEV_BASE_URL || 'https://api.typesafe.ai').replace(/\/+$/, ''),
  /** Banco de imagens para os posts gerados: Pixabay (preferido) ou Pexels. Sem chave, as sugestões de mídia ficam desligadas. */
  pixabayApiKey: env.PIXABAY_API_KEY ?? '',
  pexelsApiKey: env.PEXELS_API_KEY ?? '',
  // DATA_DIR/MEDIA_DIR permitem que os testes usem pastas temporárias.
  dataDir: env.DATA_DIR ?? path.resolve(import.meta.dirname, '..', 'data'),
  mediaDir: env.MEDIA_DIR ?? path.resolve(import.meta.dirname, '..', 'media'),
};

export const redirectUri = () => `${config.publicBaseUrl}/api/instagram/callback`;

export const fbRedirectUri = () =>
  `${config.fbRedirectBase || `http://localhost:${config.port}`}/api/facebook/callback`;

/** Lista o que falta no .env para conectar/publicar. */
export function missingConfig(): string[] {
  const missing: string[] = [];
  if (!config.igAppId) missing.push('IG_APP_ID');
  if (!config.igAppSecret) missing.push('IG_APP_SECRET');
  if (!config.publicBaseUrl.startsWith('https://')) missing.push('PUBLIC_BASE_URL (https)');
  return missing;
}

/**
 * O que falta para usar o dashboard: ao menos um login configurado (Instagram ou Facebook).
 * PUBLIC_BASE_URL fica à parte: sem ele só a publicação desliga.
 */
export function setupMissing(): string[] {
  const instagram = Boolean(config.igAppId && config.igAppSecret);
  const facebook = Boolean(config.fbAppId && config.fbAppSecret);
  return instagram || facebook ? [] : ['IG_APP_ID e IG_APP_SECRET, ou FB_APP_ID e FB_APP_SECRET'];
}

export const publishMissing = () =>
  config.publicBaseUrl.startsWith('https://') ? null : 'PUBLIC_BASE_URL (endereço https público: túnel ou servidor)';

/** O que falta no .env para a Descoberta (login do Facebook). */
export function missingFacebookConfig(): string[] {
  const missing: string[] = [];
  if (!config.fbAppId) missing.push('FB_APP_ID');
  if (!config.fbAppSecret) missing.push('FB_APP_SECRET');
  return missing;
}
