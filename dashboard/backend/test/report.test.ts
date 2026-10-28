import './helpers.ts';
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import type { DatabaseSync } from 'node:sqlite';

const { openDb, setSetting } = await import('../src/db.ts');
const { accountReport, boostCandidates, cycleReport, experimentReport, listPosts } = await import('../src/report.ts');
const { upsertDaily } = await import('../src/sync.ts');

const DAY = 86_400_000;
const NOW = new Date('2026-10-27T12:00:00').getTime();
const iso = (ms: number) => new Date(ms).toISOString();
const day = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

let db: DatabaseSync;

function addPost(
  id: string,
  daysAgo: number,
  m: { type?: string; product?: string; reach: number; shares?: number; saved?: number; likes?: number; comments?: number },
  account = 'autora',
) {
  db.prepare(
    `INSERT INTO media(id, account_id, media_type, product_type, caption, permalink, timestamp, synced_at)
     VALUES(?, ?, ?, ?, ?, ?, ?, 0)`,
  ).run(id, account, m.type ?? 'IMAGE', m.product ?? 'FEED', `post ${id}`, `https://instagram.com/p/${id}`, iso(NOW - daysAgo * DAY));
  db.prepare(
    `INSERT INTO media_insights(media_id, reach, likes, comments, saved, shares, synced_at) VALUES(?, ?, ?, ?, ?, ?, 0)`,
  ).run(id, m.reach, m.likes ?? 0, m.comments ?? 0, m.saved ?? 0, m.shares ?? 0);
}

beforeEach(() => {
  db = openDb(':memory:');
});

describe('listPosts', () => {
  it('calcula score, formato e filtra por período e formato', () => {
    addPost('a', 1, { reach: 100, shares: 2, likes: 10 });
    addPost('b', 5, { type: 'VIDEO', product: 'REELS', reach: 200, saved: 4 });
    addPost('c', 40, { reach: 50, likes: 5 });

    const all = listPosts(db, 'autora');
    assert.equal(all.length, 3);
    assert.equal(all[0].id, 'a'); // mais recente primeiro
    assert.equal(all[0].score, 20); // (2*5 + 10*1) / 100 * 100

    const recent = listPosts(db, 'autora', { from: day(NOW - 10 * DAY), to: day(NOW) });
    assert.deepEqual(recent.map((p) => p.id), ['a', 'b']);
    assert.deepEqual(listPosts(db, 'autora', { format: 'reels' }).map((p) => p.id), ['b']);
  });

  it('não mistura contas', () => {
    addPost('x', 1, { reach: 10 }, 'loja');
    assert.equal(listPosts(db, 'autora').length, 0);
    assert.equal(listPosts(db, 'loja').length, 1);
  });

  it('usa os pesos salvos nas configurações', () => {
    addPost('a', 1, { reach: 100, likes: 10 });
    setSetting('weights', { likes: 0 }, db);
    assert.equal(listPosts(db, 'autora')[0].score, 0);
  });
});

describe('accountReport', () => {
  it('soma o período, compara com o anterior e calcula crescimento de seguidores', () => {
    for (let i = 0; i < 14; i++) {
      upsertDaily('autora', day(NOW - i * DAY), { reach: i < 7 ? 100 : 50, followers: 1000 - i * 10 }, db);
    }
    addPost('a', 2, { reach: 300, shares: 3 });
    const r = accountReport(db, 'autora', 7, { connected: true, tokenExpiresAt: NOW + 30 * DAY }, NOW);
    assert.equal(r.kpis.reach, 700);
    assert.equal(r.prevKpis.reach, 350);
    assert.equal(r.kpis.followers, 1000);
    assert.equal(r.kpis.followersDelta, 60);
    assert.equal(r.kpis.posts, 1);
    assert.equal(r.byFormat[0].format, 'post');
    assert.equal(r.topPosts[0].id, 'a');
    assert.equal(r.operational.daysSinceLastPost, 2);
    assert.equal(r.operational.tokenDaysLeft, 30);
  });

  it('gera alerta de dias sem postar', () => {
    addPost('a', 10, { reach: 100 });
    const r = accountReport(db, 'autora', 30, { connected: true, tokenExpiresAt: NOW + 30 * DAY }, NOW);
    assert.ok(r.operational.alerts.some((a) => a.code === 'no-post'));
  });
});

describe('experimentReport', () => {
  it('ranqueia combinações de formato + gancho + estilo pelo score médio', () => {
    addPost('a', 1, { reach: 100, shares: 5 });
    addPost('b', 2, { reach: 100, likes: 1 });
    addPost('c', 3, { reach: 100 }); // sem experimento: fica de fora
    const tag = db.prepare('INSERT INTO media_tags(media_id, account_id, hook, style) VALUES(?, ?, ?, ?)');
    tag.run('a', 'autora', 'Pergunta', 'Educativo');
    tag.run('b', 'autora', 'Número/lista', 'Educativo');

    const r = experimentReport(db, 'autora');
    assert.equal(r.tagged, 2);
    assert.equal(r.combos[0].hook, 'Pergunta');
    assert.equal(r.byStyle[0].value, 'Educativo');
    assert.equal(r.byStyle[0].posts, 2);
  });
});

describe('cycleReport', () => {
  it('compara o ciclo com os 10 dias anteriores', () => {
    const start = day(NOW - 4 * DAY);
    addPost('dentro', 2, { reach: 100, shares: 1 });
    addPost('antes', 12, { reach: 100 });
    const r = cycleReport(db, 'autora', start, new Date(NOW));
    assert.equal(r.phase, 'testes');
    assert.equal(r.day, 5);
    assert.equal(r.current.posts, 1);
    assert.equal(r.previous.posts, 1);
    assert.equal(r.current.bestPost?.id, 'dentro');
  });
});

describe('boostCandidates', () => {
  it('sugere posts com engajamento acima da mediana e explica o porquê', () => {
    addPost('forte', 3, { reach: 100, shares: 10, saved: 5 });
    addPost('medio', 5, { reach: 500, likes: 20 });
    addPost('fraco', 6, { reach: 800, likes: 2 });
    const c = boostCandidates(db, 'autora', NOW);
    assert.equal(c[0].post.id, 'forte');
    assert.ok(c[0].reasons.length > 0);
    assert.ok(!c.some((x) => x.post.id === 'fraco'));
  });
});
