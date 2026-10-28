import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface Account {
  id: string;
  label: string;
  username: string;
  folder: string;
  connected: boolean;
  tokenExpiresAt: number | null;
  business: 'livros' | 'servicos' | 'loja';
  /** Conexão já inclui a permissão de métricas (conexões da v1 precisam reconectar). */
  hasInsights: boolean;
  syncing: boolean;
}

export interface Profile {
  user_id: string;
  username: string;
  name?: string;
  profile_picture_url?: string;
  account_type?: string;
  followers_count?: number;
  follows_count?: number;
  media_count?: number;
}

export interface Overview {
  profile: Profile;
  limit: { used: number; total: number } | null;
}

export interface MediaItem {
  id: string;
  caption?: string;
  media_type: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM';
  media_url?: string;
  thumbnail_url?: string;
  permalink: string;
  timestamp: string;
  like_count?: number;
  comments_count?: number;
}

export interface ServerConfig {
  missing: string[];
  redirectUri: string;
  publicBaseUrl: string;
}

export type PostType = 'image' | 'carousel' | 'reel';

export interface PublishRequest {
  type: PostType;
  caption: string;
  items: string[];
  coverItem?: string;
  shareToFeed?: boolean;
  trial?: boolean;
  audioName?: string;
}

// ---------- Versão 2 ----------

export type Format = 'reels' | 'carrossel' | 'post' | 'video';

export interface Post {
  id: string;
  accountId: string;
  format: Format;
  formatLabel: string;
  caption: string;
  permalink: string;
  thumbnail: string | null;
  timestamp: string;
  reach: number | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  saved: number | null;
  shares: number | null;
  profileVisits: number | null;
  follows: number | null;
  interactions: number | null;
  avgWatchSec: number | null;
  engagementRate: number | null;
  score: number | null;
  scoreParts: Record<string, number>;
  hook: string | null;
  style: string | null;
  pillar: string | null;
  notes: string;
  /** 'jev' = gancho/estilo sugeridos pelo Jev, ainda não confirmados. */
  taggedBy: string | null;
}

export interface Kpis {
  reach: number | null;
  views: number | null;
  interactions: number | null;
  accountsEngaged: number | null;
  shares: number | null;
  saves: number | null;
  profileLinksTaps: number | null;
  followers: number | null;
  followersDelta: number | null;
  posts: number;
  avgScore: number | null;
  avgEngagement: number | null;
  avgPostReach: number | null;
}

export interface Alert {
  level: 'error' | 'warn' | 'info';
  code: string;
  text: string;
}

export interface Operational {
  lastPostAt: string | null;
  daysSinceLastPost: number | null;
  postsPerWeek: number;
  tokenDaysLeft: number | null;
  lastSyncAt: number | null;
  lastSyncAttemptAt: number | null;
  syncError: string | null;
  publishLog?: {
    id: number;
    type: string;
    caption: string;
    trial: number;
    ok: number;
    error: string | null;
    permalink: string | null;
    created_at: number;
  }[];
  alerts: Alert[];
}

export interface DailyRow {
  date: string;
  followers: number | null;
  reach: number | null;
  views: number | null;
  accounts_engaged: number | null;
  total_interactions: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
  profile_links_taps: number | null;
}

export interface FormatStat {
  format: Format;
  label: string;
  posts: number;
  avgReach: number | null;
  avgScore: number | null;
  avgShares: number | null;
  avgSaves: number | null;
  avgEngagement: number | null;
}

export interface Report {
  period: { from: string; to: string; days: number; prevFrom: string; prevTo: string };
  kpis: Kpis;
  prevKpis: Kpis;
  daily: DailyRow[];
  byFormat: FormatStat[];
  byWeekday: { weekday: number; posts: number; avgReach: number | null; avgScore: number | null }[];
  byHour: { hour: number; posts: number; avgReach: number | null; avgScore: number | null }[];
  online: number[];
  signalsByWeek: ({ week: string; posts: number } & Record<'shares' | 'saved' | 'comments' | 'likes' | 'profile_visits', number>)[];
  topPosts: Post[];
  bottomPosts: Post[];
  demographics: { audience: string; breakdown: string; key: string; value: number }[];
  operational: Operational;
}

export interface CompareRow {
  accountId: string;
  label: string;
  username: string;
  kpis: Kpis;
  prevKpis: Kpis;
  byFormat: FormatStat[];
  daily: { date: string; reach: number | null; followers: number | null }[];
  operational: Operational;
}

export interface Experiments {
  tagged: number;
  combos: { format: string; hook: string; style: string; posts: number; avgScore: number | null; avgReach: number | null; avgShares: number | null; avgSaves: number | null }[];
  byHook: { value: string; posts: number; avgScore: number | null; avgReach: number | null }[];
  byStyle: { value: string; posts: number; avgScore: number | null; avgReach: number | null }[];
  byPillar: { value: string; posts: number; avgScore: number | null; avgReach: number | null }[];
  options: { hooks: string[]; styles: string[]; pillars: string[] };
}

export interface CycleWindow {
  from: string;
  to: string;
  posts: number;
  reach: number | null;
  interactions: number | null;
  followersDelta: number | null;
  avgScore: number | null;
  bestPost: Post | null;
}

export interface Cycle {
  id: number;
  accountId: string;
  startDate: string;
  objective: string;
  goals: { posts?: number; reach?: number; followers?: number; score?: number };
  checklist: { phase: 'pesquisa' | 'testes' | 'analise'; text: string; done: boolean }[];
  notes: string;
  report: { day: number; phase: 'pesquisa' | 'testes' | 'analise' | 'encerrado' | 'futuro'; current: CycleWindow; previous: CycleWindow };
}

export type DraftKind = 'image' | 'carousel' | 'reel' | 'story';
export type DraftStatus = 'ideia' | 'produzindo' | 'pronto' | 'publicado';

export interface Draft {
  id: number;
  account_id: string;
  title: string;
  kind: DraftKind;
  status: DraftStatus;
  body: string;
  notes: string;
  hook: string | null;
  style: string | null;
  pillar: string | null;
  created_at: number;
  updated_at: number;
}

export interface ClaudeMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  created_at: number;
}

export type Artifact =
  | 'legenda' | 'roteiro' | 'carrossel' | 'card' | 'ganchos' | 'hashtags' | 'som' | 'ideias' | 'melhorar' | 'analise' | 'trafego' | 'livre';

export interface AdPlan {
  id: number;
  account_id: string;
  media_id: string | null;
  objective: string;
  daily_budget: number;
  days: number;
  audience: string;
  status: 'planejado' | 'rodando' | 'concluido';
  spent: number | null;
  result_reach: number | null;
  result_actions: number | null;
  notes: string;
  created_at: number;
}

export interface BoostData {
  recommendation: { objective: string; audience: string; budget: string; tip: string };
  candidates: { post: Post; potential: number; reasons: string[] }[];
  plans: AdPlan[];
}

export interface Settings {
  weights: Record<string, number>;
  alerts: { noPostDays: number; tokenDays: number; reachDropPct: number };
  defaults: { weights: Record<string, number>; alerts: { noPostDays: number; tokenDays: number; reachDropPct: number } };
  signals: { key: string; label: string }[];
}

export type DiscoveryStatus = 'novo' | 'salvo' | 'descartado' | 'em_contato';

export interface DiscoveredProfile {
  id: number;
  username: string;
  profileUrl: string;
  source: 'hashtag' | 'afinidade' | 'manual';
  watch: boolean;
  mentionCount: number;
  hashtags: string[];
  /** true = profissional e público; false = indisponível; null = ainda não consultado. */
  available: boolean | null;
  error: string | null;
  followers: number | null;
  avgEngagement: number | null;
  postsPerWeek: number | null;
  niche: string | null;
  affinity: number;
  reasons: string[];
  status: DiscoveryStatus;
  notes: string;
  fetchedAt: number | null;
  public: {
    name: string;
    biography: string;
    website: string;
    picture: string | null;
    follows: number | null;
    mediaCount: number | null;
    lastPostAt: string | null;
    topHashtags: string[];
    recent: { permalink: string; mediaType: string; likes: number | null; comments: number | null; timestamp: string }[];
  } | null;
}

export interface HashtagUsage {
  used: number;
  limit: number;
  remaining: number;
  hashtags: { hashtag: string; queriedAt: number; freesAt: number }[];
}

export interface HashtagPost {
  id: string;
  edge: 'top' | 'recent';
  caption: string;
  mediaType: string;
  permalink: string;
  likes: number | null;
  comments: number | null;
  timestamp: string;
}

export interface DiscoverySearch {
  hashtag: string;
  cached: boolean;
  fetchedAt: number;
  posts: HashtagPost[];
  profiles: DiscoveredProfile[];
  usage: HashtagUsage | null;
}

export interface DiscoverySuggestions {
  profiles: DiscoveredProfile[];
  ownHashtags: { hashtag: string; weight: number }[];
  pendingLookups: number;
}

export interface FacebookStatus {
  missing: string[];
  redirectUri: string;
  connected: boolean;
  name: string | null;
  expiresAt: number | null;
  missingPermissions: string[];
  linked: { accountId: string; username: string; linked: boolean }[];
}

export interface Session {
  token: string;
  expiresAt: number;
}

/** Extrai a mensagem de erro enviada pelo backend. */
export function errorMessage(e: unknown): string {
  const err = e as { error?: { error?: string }; status?: number; message?: string };
  if (err?.error?.error) return err.error.error;
  if (err?.status === 0) return 'Backend fora do ar. Rode "npm run dev" na pasta dashboard.';
  return err?.message ?? 'Erro inesperado.';
}

// ---------- Jev (TypeSafe AI) ----------

export interface JevStatus {
  configured: boolean;
  model: string;
  autotagMinConfidence: number;
  usage: { kind: string; calls: number; inputTokens: number }[];
}

export interface JevDimension {
  key: 'gancho' | 'clareza' | 'cta' | 'tom';
  label: string;
  value: number;
  weight: number;
  level: string;
  confidence: number | null;
  uncertain: boolean;
}

export interface JevClassification {
  value: string;
  label: string;
  confidence: number;
  uncertain: boolean;
}

export interface CaptionReview {
  grade: number;
  dimensions: JevDimension[];
  objective: JevClassification;
  hook: JevClassification | null;
  style: JevClassification | null;
  risk: number;
  tips: string[];
  warnings: string[];
  toneEvaluated: boolean;
}

export interface AutotagResult {
  tagged: number;
  uncertain: number;
  failed: number;
  remaining: number;
}

@Injectable({ providedIn: 'root' })
export class Api {
  private http = inject(HttpClient);

  sessionStatus() {
    return firstValueFrom(this.http.get<{ hasPassword: boolean }>('/api/session/status'));
  }
  setup(password: string, remember: boolean) {
    return firstValueFrom(this.http.post<Session>('/api/session/setup', { password, remember }));
  }
  login(password: string, remember: boolean) {
    return firstValueFrom(this.http.post<Session>('/api/session/login', { password, remember }));
  }
  logout() {
    return firstValueFrom(this.http.post<void>('/api/session/logout', {}));
  }

  config() {
    return firstValueFrom(this.http.get<ServerConfig>('/api/config'));
  }
  accounts() {
    return firstValueFrom(this.http.get<Account[]>('/api/accounts'));
  }
  overview(id: string) {
    return firstValueFrom(this.http.get<Overview>(`/api/accounts/${id}/overview`));
  }
  media(id: string) {
    return firstValueFrom(this.http.get<MediaItem[]>(`/api/accounts/${id}/media`));
  }
  connect(id: string) {
    return firstValueFrom(this.http.post<{ url: string }>(`/api/accounts/${id}/connect`, {}));
  }
  disconnect(id: string) {
    return firstValueFrom(this.http.delete<void>(`/api/accounts/${id}/connection`));
  }
  connectWithToken(id: string, token: string) {
    return firstValueFrom(this.http.post<{ ok: true; username: string }>(`/api/accounts/${id}/token`, { token }));
  }

  upload(file: File) {
    const body = new FormData();
    body.append('file', file, file.name);
    return firstValueFrom(this.http.post<{ file: string }>('/api/media', body));
  }
  deleteUpload(file: string) {
    return firstValueFrom(this.http.delete<void>(`/api/media/${encodeURIComponent(file)}`));
  }
  publish(id: string, req: PublishRequest) {
    return firstValueFrom(
      this.http.post<{ id: string; permalink?: string }>(`/api/accounts/${id}/publish`, req),
    );
  }

  // ---------- Versão 2 ----------

  syncAccount(id: string) {
    return firstValueFrom(this.http.post<void>(`/api/accounts/${id}/sync`, {}));
  }
  syncAll() {
    return firstValueFrom(this.http.post<void>('/api/sync', {}));
  }
  syncStatus() {
    return firstValueFrom(
      this.http.get<{ accountId: string; syncing: boolean; lastSuccessAt: number | null; lastError: string | null }[]>(
        '/api/sync/status',
      ),
    );
  }
  report(id: string, days: number) {
    return firstValueFrom(this.http.get<Report>(`/api/accounts/${id}/report`, { params: { days } }));
  }
  posts(id: string, filter: { from?: string; to?: string; format?: string } = {}) {
    return firstValueFrom(this.http.get<Post[]>(`/api/accounts/${id}/posts`, { params: clean(filter) }));
  }
  postsCsv(id: string, filter: { from?: string; to?: string; format?: string } = {}) {
    return firstValueFrom(
      this.http.get(`/api/accounts/${id}/posts.csv`, { params: clean(filter), responseType: 'blob' }),
    );
  }
  compare(days: number) {
    return firstValueFrom(this.http.get<CompareRow[]>('/api/compare', { params: { days } }));
  }
  alerts() {
    return firstValueFrom(this.http.get<{ accountId: string; alerts: Alert[] }[]>('/api/alerts'));
  }
  settings() {
    return firstValueFrom(this.http.get<Settings>('/api/settings'));
  }
  saveSettings(body: Pick<Settings, 'weights' | 'alerts'>) {
    return firstValueFrom(this.http.put<Pick<Settings, 'weights' | 'alerts'>>('/api/settings', body));
  }

  saveTags(mediaId: string, tags: { hook: string | null; style: string | null; pillar: string | null; notes: string }) {
    return firstValueFrom(this.http.put<void>(`/api/media/${mediaId}/tags`, tags));
  }
  experiments(id: string) {
    return firstValueFrom(this.http.get<Experiments>(`/api/accounts/${id}/experiments`));
  }

  cycles(id: string) {
    return firstValueFrom(this.http.get<Cycle[]>(`/api/accounts/${id}/cycles`));
  }
  createCycle(id: string, body: { startDate: string; objective: string; goals: Cycle['goals'] }) {
    return firstValueFrom(this.http.post<Cycle>(`/api/accounts/${id}/cycles`, body));
  }
  updateCycle(cid: number, body: Partial<Pick<Cycle, 'objective' | 'goals' | 'checklist' | 'notes'>>) {
    return firstValueFrom(this.http.put<Cycle>(`/api/cycles/${cid}`, body));
  }
  deleteCycle(cid: number) {
    return firstValueFrom(this.http.delete<void>(`/api/cycles/${cid}`));
  }

  drafts(id: string) {
    return firstValueFrom(this.http.get<Draft[]>(`/api/accounts/${id}/drafts`));
  }
  createDraft(id: string, body: { title: string; kind: DraftKind; body?: string }) {
    return firstValueFrom(this.http.post<Draft>(`/api/accounts/${id}/drafts`, body));
  }
  updateDraft(did: number, body: Partial<Omit<Draft, 'id' | 'account_id' | 'created_at' | 'updated_at'>>) {
    return firstValueFrom(this.http.put<Draft>(`/api/drafts/${did}`, body));
  }
  deleteDraft(did: number) {
    return firstValueFrom(this.http.delete<void>(`/api/drafts/${did}`));
  }
  draftMessages(did: number) {
    return firstValueFrom(this.http.get<ClaudeMessage[]>(`/api/drafts/${did}/messages`));
  }

  askClaude(body: { accountId: string; artifact: Artifact; instruction: string; currentText?: string; draftId?: number }) {
    return firstValueFrom(this.http.post<{ text: string }>('/api/claude', body));
  }

  boost(id: string) {
    return firstValueFrom(this.http.get<BoostData>(`/api/accounts/${id}/boost`));
  }
  createAdPlan(id: string, body: { mediaId?: string | null; objective: string; dailyBudget: number; days: number; audience: string; notes?: string }) {
    return firstValueFrom(this.http.post<AdPlan>(`/api/accounts/${id}/ad-plans`, body));
  }
  updateAdPlan(pid: number, body: Partial<{ status: AdPlan['status']; spent: number | null; resultReach: number | null; resultActions: number | null; notes: string }>) {
    return firstValueFrom(this.http.put<AdPlan>(`/api/ad-plans/${pid}`, body));
  }
  deleteAdPlan(pid: number) {
    return firstValueFrom(this.http.delete<void>(`/api/ad-plans/${pid}`));
  }

  facebookStatus() {
    return firstValueFrom(this.http.get<FacebookStatus>('/api/facebook/status'));
  }
  facebookConnect(accountId: string) {
    return firstValueFrom(this.http.post<{ url: string }>('/api/facebook/connect', { accountId }));
  }
  facebookDisconnect() {
    return firstValueFrom(this.http.delete<void>('/api/facebook/connection'));
  }
  discoveryUsage(id: string) {
    return firstValueFrom(this.http.get<{ via: string | null; usage: HashtagUsage | null }>(`/api/accounts/${id}/discovery/usage`));
  }
  discoverySearch(id: string, q: string) {
    return firstValueFrom(this.http.get<DiscoverySearch>(`/api/accounts/${id}/discovery/search`, { params: { q } }));
  }
  discoverySuggestions(id: string) {
    return firstValueFrom(this.http.get<DiscoverySuggestions>(`/api/accounts/${id}/discovery/suggestions`));
  }
  discoverySaved(id: string) {
    return firstValueFrom(this.http.get<DiscoveredProfile[]>(`/api/accounts/${id}/discovery/profiles`));
  }
  addToWatchlist(id: string, username: string) {
    return firstValueFrom(this.http.post<DiscoveredProfile>(`/api/accounts/${id}/discovery/watchlist`, { username }));
  }
  updateDiscovered(profileId: number, body: Partial<{ status: DiscoveryStatus; notes: string; watch: boolean }>) {
    return firstValueFrom(this.http.patch<DiscoveredProfile>(`/api/discovery/${profileId}`, body));
  }

  jevStatus() {
    return firstValueFrom(this.http.get<JevStatus>('/api/jev/status'));
  }
  reviewCaption(id: string, body: { caption: string; kind?: string }) {
    return firstValueFrom(this.http.post<CaptionReview>(`/api/accounts/${id}/jev/review`, body));
  }
  autotagPending(id: string) {
    return firstValueFrom(this.http.get<{ pending: number }>(`/api/accounts/${id}/jev/autotag`));
  }
  autotag(id: string) {
    return firstValueFrom(this.http.post<AutotagResult>(`/api/accounts/${id}/jev/autotag`, {}));
  }
}

function clean(params: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(params).filter(([, v]) => v)) as Record<string, string>;
}
