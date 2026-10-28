// Rotas da versão 2: relatórios, experimentos, ciclos, rascunhos, Claude e tráfego pago.
// Todas exigem sessão do dashboard (aplicada em server.ts).
import express, { type NextFunction, type Request, type Response } from 'express';
import { ACCOUNTS, findAccount, type AccountConfig, type AdRecommendation } from './config.ts';
import { ARTIFACTS, ClaudeError, askClaude, type Artifact } from './claude.ts';
import { db, setSetting } from './db.ts';
import { DEFAULT_HOOKS, DEFAULT_STYLES, DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS, SIGNALS, SIGNAL_LABELS, toCsv, type Format } from './metrics.ts';
import {
  accountReport,
  boostCandidates,
  cycleReport,
  experimentReport,
  listPosts,
  operationalReport,
  thresholdsOf,
  weightsOf,
} from './report.ts';
import { read } from './store.ts';
import { isSyncing, syncAccount, syncAll } from './sync.ts';

export const v2 = express.Router();

const handle =
  (fn: (req: Request, res: Response) => Promise<void> | void) => (req: Request, res: Response, next: NextFunction) => {
    try {
      Promise.resolve(fn(req, res)).catch(next);
    } catch (e) {
      next(e);
    }
  };

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function account(req: Request): AccountConfig {
  const a = findAccount(req.params.id as string);
  if (!a) throw new HttpError(404, 'Conta desconhecida.');
  return a;
}

function ctx(accountId: string) {
  const c = read().connections[accountId];
  return { connected: Boolean(c) && c.tokenExpiresAt > Date.now(), tokenExpiresAt: c?.tokenExpiresAt ?? null };
}

const str = (v: unknown, max = 5000) => (typeof v === 'string' ? v.slice(0, max) : '');
const optStr = (v: unknown, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const days = (v: unknown) => Math.min(365, Math.max(7, Number(v) || 30));
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

// ---------- Sincronização ----------

v2.post('/sync', (_req, res) => {
  syncAll().catch((e) => console.error('sync:', e));
  res.status(202).json({ started: true });
});

v2.post(
  '/accounts/:id/sync',
  handle((req, res) => {
    const a = account(req);
    if (!ctx(a.id).connected) throw new HttpError(409, 'Conta não conectada.');
    syncAccount(a.id).catch((e) => console.error('sync:', e));
    res.status(202).json({ started: true });
  }),
);

v2.get('/sync/status', (_req, res) => {
  res.json(
    ACCOUNTS.map((a) => {
      const s = db.prepare('SELECT * FROM account_sync WHERE account_id = ?').get(a.id) as Record<string, unknown> | undefined;
      return { accountId: a.id, syncing: isSyncing(a.id), lastSuccessAt: s?.last_success_at ?? null, lastError: s?.last_error ?? null };
    }),
  );
});

// ---------- Relatórios ----------

v2.get(
  '/accounts/:id/report',
  handle((req, res) => {
    const a = account(req);
    res.json(accountReport(db, a.id, days(req.query.days), ctx(a.id)));
  }),
);

function postFilter(req: Request) {
  const formats: Format[] = ['reels', 'carrossel', 'post', 'video'];
  return {
    from: isDate(req.query.from) ? req.query.from : undefined,
    to: isDate(req.query.to) ? req.query.to : undefined,
    format: formats.includes(req.query.format as Format) ? (req.query.format as Format) : undefined,
  };
}

v2.get(
  '/accounts/:id/posts',
  handle((req, res) => {
    res.json(listPosts(db, account(req).id, postFilter(req)));
  }),
);

v2.get(
  '/accounts/:id/posts.csv',
  handle((req, res) => {
    const a = account(req);
    const posts = listPosts(db, a.id, postFilter(req)).map((p) => ({
      ...p,
      date: new Date(p.timestamp).toLocaleString('pt-BR'),
      caption: p.caption.replace(/\s+/g, ' '),
    }));
    const csv = toCsv(posts, [
      { key: 'date', label: 'Data' },
      { key: 'formatLabel', label: 'Formato' },
      { key: 'caption', label: 'Legenda' },
      { key: 'reach', label: 'Alcance' },
      { key: 'views', label: 'Visualizações' },
      { key: 'likes', label: 'Curtidas' },
      { key: 'comments', label: 'Comentários' },
      { key: 'saved', label: 'Salvamentos' },
      { key: 'shares', label: 'Compartilhamentos' },
      { key: 'profileVisits', label: 'Visitas ao perfil' },
      { key: 'follows', label: 'Novos seguidores' },
      { key: 'avgWatchSec', label: 'Tempo médio assistido (s)' },
      { key: 'engagementRate', label: 'Engajamento (%)' },
      { key: 'score', label: 'Score' },
      { key: 'hook', label: 'Gancho' },
      { key: 'style', label: 'Estilo' },
      { key: 'pillar', label: 'Pilar' },
      { key: 'notes', label: 'Anotações' },
      { key: 'permalink', label: 'Link' },
    ]);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="posts-${a.id}.csv"`);
    res.send(csv);
  }),
);

v2.get('/compare', (req, res) => {
  const d = days(req.query.days);
  res.json(
    ACCOUNTS.map((a) => {
      const r = accountReport(db, a.id, d, ctx(a.id));
      return {
        accountId: a.id,
        label: a.label,
        username: a.username,
        kpis: r.kpis,
        prevKpis: r.prevKpis,
        byFormat: r.byFormat,
        daily: r.daily.map((x) => ({ date: x.date, reach: x.reach, followers: x.followers })),
        operational: { ...r.operational, publishLog: undefined },
      };
    }),
  );
});

v2.get('/alerts', (_req, res) => {
  res.json(ACCOUNTS.map((a) => ({ accountId: a.id, alerts: operationalReport(db, a.id, ctx(a.id)).alerts })));
});

v2.get('/settings', (_req, res) => {
  res.json({
    weights: weightsOf(db),
    alerts: thresholdsOf(db),
    defaults: { weights: DEFAULT_WEIGHTS, alerts: DEFAULT_THRESHOLDS },
    signals: SIGNALS.map((s) => ({ key: s, label: SIGNAL_LABELS[s] })),
  });
});

v2.put('/settings', (req, res) => {
  const { weights, alerts } = req.body ?? {};
  if (weights) {
    setSetting(
      'weights',
      Object.fromEntries(SIGNALS.map((s) => [s, Math.max(0, Math.min(20, Number(weights[s]) || 0))])),
    );
  }
  if (alerts) {
    setSetting('alerts', {
      noPostDays: Math.max(1, Number(alerts.noPostDays) || DEFAULT_THRESHOLDS.noPostDays),
      tokenDays: Math.max(1, Number(alerts.tokenDays) || DEFAULT_THRESHOLDS.tokenDays),
      reachDropPct: Math.max(5, Number(alerts.reachDropPct) || DEFAULT_THRESHOLDS.reachDropPct),
    });
  }
  res.json({ weights: weightsOf(db), alerts: thresholdsOf(db) });
});

// ---------- Experimentos ----------

v2.put(
  '/media/:mediaId/tags',
  handle((req, res) => {
    const media = db.prepare('SELECT account_id FROM media WHERE id = ?').get(req.params.mediaId as string) as
      | { account_id: string }
      | undefined;
    if (!media) throw new HttpError(404, 'Post não encontrado. Sincronize a conta.');
    const b = req.body ?? {};
    db.prepare(
      `INSERT INTO media_tags(media_id, account_id, hook, style, pillar, notes) VALUES(?, ?, ?, ?, ?, ?)
       ON CONFLICT(media_id) DO UPDATE SET hook = excluded.hook, style = excluded.style, pillar = excluded.pillar,
         notes = excluded.notes, tagged_by = NULL, tag_confidence = NULL`,
    ).run(req.params.mediaId as string, media.account_id, optStr(b.hook), optStr(b.style), optStr(b.pillar), str(b.notes));
    res.status(204).end();
  }),
);

v2.get(
  '/accounts/:id/experiments',
  handle((req, res) => {
    const a = account(req);
    const distinct = (col: string) =>
      (db.prepare(`SELECT DISTINCT ${col} AS v FROM media_tags WHERE account_id = ? AND ${col} IS NOT NULL`).all(a.id) as {
        v: string;
      }[]).map((r) => r.v);
    res.json({
      ...experimentReport(db, a.id),
      options: {
        hooks: [...new Set([...DEFAULT_HOOKS, ...distinct('hook')])],
        styles: [...new Set([...DEFAULT_STYLES, ...distinct('style')])],
        pillars: distinct('pillar'),
      },
    });
  }),
);

// ---------- Ciclos de 10 dias ----------

const DEFAULT_CHECKLIST = [
  { phase: 'pesquisa', text: 'Revisar o relatório dos últimos 30 dias' },
  { phase: 'pesquisa', text: 'Separar 3 conteúdos de referência do nicho' },
  { phase: 'pesquisa', text: 'Definir 2 hipóteses para testar (formato + gancho)' },
  { phase: 'pesquisa', text: 'Planejar os posts dos dias 4 a 7 (Rascunhos)' },
  { phase: 'testes', text: 'Publicar o teste A' },
  { phase: 'testes', text: 'Publicar o teste B' },
  { phase: 'testes', text: 'Responder comentários na primeira hora' },
  { phase: 'testes', text: 'Registrar gancho e estilo de cada post (Experimentos)' },
  { phase: 'analise', text: 'Comparar o score dos testes' },
  { phase: 'analise', text: 'Escolher a combinação vencedora' },
  { phase: 'analise', text: 'Decidir se algum post merece impulsionamento' },
  { phase: 'analise', text: 'Planejar o próximo ciclo' },
].map((c) => ({ ...c, done: false }));

type CycleRow = { id: number; account_id: string; start_date: string; objective: string; goals: string; checklist: string; notes: string };

function cycleOut(c: CycleRow) {
  return {
    id: c.id,
    accountId: c.account_id,
    startDate: c.start_date,
    objective: c.objective,
    goals: JSON.parse(c.goals),
    checklist: JSON.parse(c.checklist),
    notes: c.notes,
    report: cycleReport(db, c.account_id, c.start_date),
  };
}

function cycleById(id: unknown): CycleRow {
  const c = db.prepare('SELECT * FROM cycles WHERE id = ?').get(Number(id)) as CycleRow | undefined;
  if (!c) throw new HttpError(404, 'Ciclo não encontrado.');
  return c;
}

v2.get(
  '/accounts/:id/cycles',
  handle((req, res) => {
    const rows = db.prepare('SELECT * FROM cycles WHERE account_id = ? ORDER BY start_date DESC').all(account(req).id) as CycleRow[];
    res.json(rows.map(cycleOut));
  }),
);

v2.post(
  '/accounts/:id/cycles',
  handle((req, res) => {
    const a = account(req);
    const b = req.body ?? {};
    if (!isDate(b.startDate)) throw new HttpError(400, 'Informe a data de início.');
    const r = db
      .prepare('INSERT INTO cycles(account_id, start_date, objective, goals, checklist, created_at) VALUES(?, ?, ?, ?, ?, ?)')
      .run(a.id, b.startDate, str(b.objective, 1000), JSON.stringify(b.goals ?? {}), JSON.stringify(DEFAULT_CHECKLIST), Date.now());
    res.status(201).json(cycleOut(cycleById(r.lastInsertRowid)));
  }),
);

v2.put(
  '/cycles/:cid',
  handle((req, res) => {
    const c = cycleById(req.params.cid);
    const b = req.body ?? {};
    db.prepare('UPDATE cycles SET objective = ?, goals = ?, checklist = ?, notes = ?, start_date = ? WHERE id = ?').run(
      b.objective !== undefined ? str(b.objective, 1000) : c.objective,
      b.goals !== undefined ? JSON.stringify(b.goals) : c.goals,
      Array.isArray(b.checklist) ? JSON.stringify(b.checklist.slice(0, 50)) : c.checklist,
      b.notes !== undefined ? str(b.notes) : c.notes,
      isDate(b.startDate) ? b.startDate : c.start_date,
      c.id,
    );
    res.json(cycleOut(cycleById(c.id)));
  }),
);

v2.delete(
  '/cycles/:cid',
  handle((req, res) => {
    db.prepare('DELETE FROM cycles WHERE id = ?').run(cycleById(req.params.cid).id);
    res.status(204).end();
  }),
);

// ---------- Rascunhos (artefatos em elaboração) ----------

const KINDS = ['image', 'carousel', 'reel', 'story'];
const STATUSES = ['ideia', 'produzindo', 'pronto', 'publicado'];

type DraftRow = Record<string, unknown> & { id: number };

/** Rascunho para a tela: a mídia sugerida vai como lista, não como texto JSON. */
const draftOut = (d: DraftRow) => ({ ...d, media: JSON.parse(String(d.media ?? '[]')) });

function draftById(id: unknown): DraftRow {
  const d = db.prepare('SELECT * FROM drafts WHERE id = ?').get(Number(id)) as DraftRow | undefined;
  if (!d) throw new HttpError(404, 'Rascunho não encontrado.');
  return d;
}

v2.get(
  '/accounts/:id/drafts',
  handle((req, res) => {
    res.json((db.prepare('SELECT * FROM drafts WHERE account_id = ? ORDER BY updated_at DESC').all(account(req).id) as DraftRow[]).map(draftOut));
  }),
);

v2.post(
  '/accounts/:id/drafts',
  handle((req, res) => {
    const a = account(req);
    const b = req.body ?? {};
    const now = Date.now();
    const r = db
      .prepare('INSERT INTO drafts(account_id, title, kind, status, body, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?)')
      .run(a.id, optStr(b.title) ?? 'Sem título', KINDS.includes(b.kind) ? b.kind : 'image', 'ideia', str(b.body, 20000), now, now);
    res.status(201).json(draftOut(draftById(r.lastInsertRowid)));
  }),
);

v2.put(
  '/drafts/:did',
  handle((req, res) => {
    const d = draftById(req.params.did);
    const b = req.body ?? {};
    const pick = (key: string, value: unknown) => (b[key] !== undefined ? value : d[key]);
    db.prepare(
      `UPDATE drafts SET title = ?, kind = ?, status = ?, body = ?, notes = ?, hook = ?, style = ?, pillar = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      pick('title', optStr(b.title) ?? 'Sem título') as string,
      pick('kind', KINDS.includes(b.kind) ? b.kind : d.kind) as string,
      pick('status', STATUSES.includes(b.status) ? b.status : d.status) as string,
      pick('body', str(b.body, 20000)) as string,
      pick('notes', str(b.notes)) as string,
      pick('hook', optStr(b.hook)) as string | null,
      pick('style', optStr(b.style)) as string | null,
      pick('pillar', optStr(b.pillar)) as string | null,
      Date.now(),
      d.id,
    );
    res.json(draftOut(draftById(d.id)));
  }),
);

v2.delete(
  '/drafts/:did',
  handle((req, res) => {
    db.prepare('DELETE FROM drafts WHERE id = ?').run(draftById(req.params.did).id);
    res.status(204).end();
  }),
);

v2.get(
  '/drafts/:did/messages',
  handle((req, res) => {
    res.json(
      db.prepare('SELECT * FROM claude_messages WHERE draft_id = ? ORDER BY id').all(draftById(req.params.did).id),
    );
  }),
);

// ---------- Claude (assinatura via Claude Code) ----------

v2.get('/claude/artifacts', (_req, res) => {
  res.json(Object.keys(ARTIFACTS));
});

v2.post(
  '/claude',
  handle(async (req, res) => {
    const b = req.body ?? {};
    const acc = findAccount(b.accountId);
    if (!acc) throw new HttpError(400, 'Conta desconhecida.');
    const artifact: Artifact = b.artifact in ARTIFACTS ? b.artifact : 'livre';
    const instruction = str(b.instruction, 4000);
    const draftId = b.draftId ? draftById(b.draftId).id : null;
    const history = draftId
      ? (db
          .prepare('SELECT role, content FROM claude_messages WHERE draft_id = ? ORDER BY id DESC LIMIT 10')
          .all(draftId) as { role: 'user' | 'assistant'; content: string }[]).reverse()
      : [];

    const text = await askClaude(db, { account: acc, artifact, instruction, currentText: str(b.currentText, 20000), history });

    if (draftId) {
      const insert = db.prepare('INSERT INTO claude_messages(draft_id, account_id, role, content, created_at) VALUES(?, ?, ?, ?, ?)');
      insert.run(draftId, acc.id, 'user', `[${artifact}] ${instruction}`.trim(), Date.now());
      insert.run(draftId, acc.id, 'assistant', text, Date.now());
    }
    res.json({ text });
  }),
);

// ---------- Tráfego pago (planejamento) ----------

// Padrão por tipo de negócio; cada conta pode sobrepor em accounts.json (campo "ads").
const AD_RECOMMENDATIONS: Record<AccountConfig['business'], AdRecommendation> = {
  livros: {
    objective: 'Tráfego (cliques no link de compra) ou Visitas ao perfil',
    audience: 'Leitores: interesses em livros, leitura e no tema da obra; 25-60 anos; Brasil.',
    budget: 'Teste com R$ 15 a R$ 30 por dia, por 5 a 7 dias.',
    tip: 'Impulsione Reels com trecho lido ou bastidores que já tiveram muitos compartilhamentos.',
  },
  servicos: {
    objective: 'Mensagens (orçamento) ou Cadastros (leads)',
    audience: 'Quem contrata o seu serviço: profissão ou setor, interesses ligados ao problema que você resolve e a região que você atende.',
    budget: 'Teste com R$ 20 a R$ 40 por dia, por 7 dias.',
    tip: 'Impulsione conteúdos educativos com muitos salvamentos e cases com depoimento: autoridade e prova social convertem em serviço.',
  },
  loja: {
    objective: 'Mensagens ou Visitas ao site/loja (vendas)',
    audience: 'Interesses ligados aos seus produtos (ex.: decoração, casa, presentes); foque na sua região se a entrega é local; 25-55 anos.',
    budget: 'Teste com R$ 20 a R$ 50 por dia, por 5 a 7 dias; aumente o que vender.',
    tip: 'Impulsione Reels do produto em uso e carrosséis com preço e condição claros na legenda.',
  },
};

v2.get(
  '/accounts/:id/boost',
  handle((req, res) => {
    const a = account(req);
    res.json({
      recommendation: { ...AD_RECOMMENDATIONS[a.business], ...a.ads },
      candidates: boostCandidates(db, a.id),
      plans: db.prepare('SELECT * FROM ad_plans WHERE account_id = ? ORDER BY created_at DESC').all(a.id),
    });
  }),
);

const AD_STATUSES = ['planejado', 'rodando', 'concluido'];

v2.post(
  '/accounts/:id/ad-plans',
  handle((req, res) => {
    const a = account(req);
    const b = req.body ?? {};
    const budget = Number(b.dailyBudget);
    const d = Number(b.days);
    if (!(budget > 0) || !(d > 0)) throw new HttpError(400, 'Informe orçamento diário e número de dias.');
    const r = db
      .prepare(
        `INSERT INTO ad_plans(account_id, media_id, objective, daily_budget, days, audience, status, notes, created_at)
         VALUES(?, ?, ?, ?, ?, ?, 'planejado', ?, ?)`,
      )
      .run(a.id, optStr(b.mediaId), str(b.objective, 300) || 'Não definido', budget, Math.round(d), str(b.audience, 2000), str(b.notes), Date.now());
    res.status(201).json(db.prepare('SELECT * FROM ad_plans WHERE id = ?').get(r.lastInsertRowid));
  }),
);

v2.put(
  '/ad-plans/:pid',
  handle((req, res) => {
    const p = db.prepare('SELECT * FROM ad_plans WHERE id = ?').get(Number(req.params.pid)) as Record<string, any> | undefined;
    if (!p) throw new HttpError(404, 'Plano não encontrado.');
    const b = req.body ?? {};
    const num = (v: unknown, cur: unknown) => (v === undefined ? cur : v === null || v === '' ? null : Number(v));
    db.prepare(
      `UPDATE ad_plans SET status = ?, spent = ?, result_reach = ?, result_actions = ?, notes = ?, audience = ?, objective = ?
       WHERE id = ?`,
    ).run(
      AD_STATUSES.includes(b.status) ? b.status : p.status,
      num(b.spent, p.spent) as number | null,
      num(b.resultReach, p.result_reach) as number | null,
      num(b.resultActions, p.result_actions) as number | null,
      b.notes !== undefined ? str(b.notes) : p.notes,
      b.audience !== undefined ? str(b.audience, 2000) : p.audience,
      b.objective !== undefined ? str(b.objective, 300) : p.objective,
      p.id,
    );
    res.json(db.prepare('SELECT * FROM ad_plans WHERE id = ?').get(p.id));
  }),
);

v2.delete('/ad-plans/:pid', (req, res) => {
  db.prepare('DELETE FROM ad_plans WHERE id = ?').run(Number(req.params.pid));
  res.status(204).end();
});

v2.use((err: Error, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof HttpError) return void res.status(err.status).json({ error: err.message });
  if (err instanceof ClaudeError) return void res.status(503).json({ error: err.message });
  next(err);
});

