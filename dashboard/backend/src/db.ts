import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.ts';

// Cada item roda uma vez; a posição no array é a versão (PRAGMA user_version).
const MIGRATIONS: string[] = [
  `
  CREATE TABLE media (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    media_type TEXT NOT NULL,
    product_type TEXT,
    caption TEXT,
    permalink TEXT,
    thumbnail_url TEXT,
    timestamp TEXT NOT NULL,
    like_count INTEGER,
    comments_count INTEGER,
    synced_at INTEGER NOT NULL
  );
  CREATE INDEX media_account_ts ON media(account_id, timestamp);

  -- Último valor lifetime das métricas de cada mídia.
  CREATE TABLE media_insights (
    media_id TEXT PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
    reach INTEGER, views INTEGER, likes INTEGER, comments INTEGER, saved INTEGER, shares INTEGER,
    total_interactions INTEGER, profile_visits INTEGER, follows INTEGER, reposts INTEGER,
    avg_watch_time_ms INTEGER,
    synced_at INTEGER NOT NULL
  );

  -- Série diária da conta (followers = foto do dia em que sincronizou).
  CREATE TABLE account_daily (
    account_id TEXT NOT NULL,
    date TEXT NOT NULL,
    followers INTEGER,
    reach INTEGER, views INTEGER, accounts_engaged INTEGER, total_interactions INTEGER,
    likes INTEGER, comments INTEGER, saves INTEGER, shares INTEGER, profile_links_taps INTEGER,
    PRIMARY KEY (account_id, date)
  );

  CREATE TABLE account_demographics (
    account_id TEXT NOT NULL,
    audience TEXT NOT NULL,     -- followers | engaged
    breakdown TEXT NOT NULL,    -- age | gender | city | country
    key TEXT NOT NULL,
    value INTEGER NOT NULL,
    PRIMARY KEY (account_id, audience, breakdown, key)
  );

  -- Média de seguidores online por hora (0-23), últimos 30 dias.
  CREATE TABLE account_online (
    account_id TEXT NOT NULL,
    hour INTEGER NOT NULL,
    value INTEGER NOT NULL,
    PRIMARY KEY (account_id, hour)
  );

  CREATE TABLE account_sync (
    account_id TEXT PRIMARY KEY,
    last_attempt_at INTEGER,
    last_success_at INTEGER,
    last_error TEXT
  );

  CREATE TABLE publish_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL,
    type TEXT NOT NULL,
    caption TEXT,
    trial INTEGER NOT NULL DEFAULT 0,
    ok INTEGER NOT NULL,
    error TEXT,
    media_id TEXT,
    permalink TEXT,
    created_at INTEGER NOT NULL
  );

  -- Artefatos em elaboração (legendas, roteiros, textos de carrossel...).
  CREATE TABLE drafts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL,
    title TEXT NOT NULL,
    kind TEXT NOT NULL,          -- image | carousel | reel | story
    status TEXT NOT NULL,        -- ideia | produzindo | pronto | publicado
    body TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    hook TEXT, style TEXT, pillar TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE claude_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    draft_id INTEGER REFERENCES drafts(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL,
    role TEXT NOT NULL,          -- user | assistant
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  -- Registro de experimento por post (formato vem da mídia).
  CREATE TABLE media_tags (
    media_id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    hook TEXT, style TEXT, pillar TEXT,
    notes TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE cycles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL,
    start_date TEXT NOT NULL,
    objective TEXT NOT NULL DEFAULT '',
    goals TEXT NOT NULL DEFAULT '{}',      -- JSON
    checklist TEXT NOT NULL DEFAULT '[]',  -- JSON [{text, phase, done}]
    notes TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE ad_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL,
    media_id TEXT,
    objective TEXT NOT NULL,
    daily_budget REAL NOT NULL,
    days INTEGER NOT NULL,
    audience TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,                  -- planejado | rodando | concluido
    spent REAL, result_reach INTEGER, result_actions INTEGER,
    notes TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  // Dashboard v3: Descoberta de perfis.
  `
  CREATE TABLE discovery_queries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL,
    term TEXT NOT NULL,
    hashtag TEXT NOT NULL,
    cached INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  -- Cada consulta real à API de hashtag (a Meta limita 30 hashtags únicas por 7 dias por conta).
  CREATE TABLE hashtag_usage (
    account_id TEXT NOT NULL,
    hashtag TEXT NOT NULL,
    queried_at INTEGER NOT NULL
  );
  CREATE INDEX hashtag_usage_account ON hashtag_usage(account_id, queried_at);

  -- O id da hashtag é global e fixo; as mídias valem 24h.
  CREATE TABLE hashtag_cache (
    hashtag TEXT PRIMARY KEY,
    hashtag_id TEXT,
    top_media TEXT NOT NULL DEFAULT '[]',
    recent_media TEXT NOT NULL DEFAULT '[]',
    fetched_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE discovered_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL,
    username TEXT NOT NULL,
    ig_user_id TEXT,
    source TEXT NOT NULL,                  -- hashtag | afinidade | manual
    watch INTEGER NOT NULL DEFAULT 0,      -- concorrente/referência cadastrado
    mention_count INTEGER NOT NULL DEFAULT 0,
    hashtags TEXT NOT NULL DEFAULT '[]',   -- hashtags pesquisadas em que apareceu
    available INTEGER,                     -- 1 público/profissional, 0 indisponível, null não consultado
    error TEXT,
    data TEXT,                             -- resumo público (JSON)
    followers INTEGER,
    avg_engagement REAL,
    posts_per_week REAL,
    niche TEXT,
    affinity REAL NOT NULL DEFAULT 0,
    reasons TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'novo',   -- novo | salvo | descartado | em_contato
    notes TEXT NOT NULL DEFAULT '',
    fetched_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (account_id, username)
  );
  `,
];

export function openDb(file: string): DatabaseSync {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const { user_version: current } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  return db;
}

export const db = openDb(path.join(config.dataDir, 'dashboard.db'));

export function transaction<T>(fn: () => T, database: DatabaseSync = db): T {
  database.exec('BEGIN');
  try {
    const result = fn();
    database.exec('COMMIT');
    return result;
  } catch (e) {
    database.exec('ROLLBACK');
    throw e;
  }
}

export function getSetting<T>(key: string, fallback: T, database: DatabaseSync = db): T {
  const row = database.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as T) : fallback;
}

export function setSetting(key: string, value: unknown, database: DatabaseSync = db): void {
  database
    .prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}
