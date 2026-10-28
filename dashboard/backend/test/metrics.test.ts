import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_THRESHOLDS,
  DEFAULT_WEIGHTS,
  computeAlerts,
  cyclePhase,
  engagementRate,
  formatOf,
  scorePost,
  toCsv,
} from '../src/metrics.ts';

describe('scorePost', () => {
  it('normaliza pelo alcance: mesmo engajamento relativo => mesmo score', () => {
    const small = scorePost({ reach: 100, shares: 1, saved: 2, comments: 1, likes: 10, profile_visits: 2 });
    const big = scorePost({ reach: 1000, shares: 10, saved: 20, comments: 10, likes: 100, profile_visits: 20 });
    assert.equal(small.score, big.score);
  });

  it('aplica os pesos padrão e decompõe por sinal', () => {
    const s = scorePost({ reach: 100, shares: 1, saved: 1, comments: 1, likes: 1, profile_visits: 2 });
    assert.deepEqual(s.parts, { shares: 5, saved: 4, comments: 3, likes: 1, profile_visits: 1 });
    assert.equal(s.score, 14);
  });

  it('compartilhar vale mais que curtir', () => {
    const shares = scorePost({ reach: 100, shares: 1 });
    const likes = scorePost({ reach: 100, likes: 1 });
    assert.ok(shares.score! > likes.score!);
  });

  it('aceita pesos personalizados', () => {
    const s = scorePost({ reach: 100, likes: 10 }, { ...DEFAULT_WEIGHTS, likes: 0 });
    assert.equal(s.score, 0);
  });

  it('sem alcance não há score', () => {
    assert.equal(scorePost({ reach: 0, likes: 5 }).score, null);
    assert.equal(scorePost({ likes: 5 }).score, null);
  });
});

describe('engagementRate', () => {
  it('calcula interações / alcance em %', () => {
    assert.equal(engagementRate(25, 500), 5);
    assert.equal(engagementRate(10, 0), null);
    assert.equal(engagementRate(null, 100), null);
  });
});

describe('formatOf', () => {
  it('identifica os formatos', () => {
    assert.equal(formatOf('VIDEO', 'REELS'), 'reels');
    assert.equal(formatOf('CAROUSEL_ALBUM', 'FEED'), 'carrossel');
    assert.equal(formatOf('IMAGE', 'FEED'), 'post');
    assert.equal(formatOf('VIDEO', 'FEED'), 'video');
  });
});

describe('computeAlerts', () => {
  const base = {
    connected: true,
    tokenDaysLeft: 50,
    daysSinceLastPost: 1,
    reachLast7: 1000,
    reachPrev7: 1000,
    syncError: null,
    failuresLast24h: 0,
  };

  it('sem problemas => sem alertas', () => {
    assert.deepEqual(computeAlerts(base), []);
  });

  it('conta desconectada gera só o alerta de conexão', () => {
    const a = computeAlerts({ ...base, connected: false, daysSinceLastPost: 30 });
    assert.deepEqual(a.map((x) => x.code), ['disconnected']);
  });

  it('detecta token perto de expirar, dias sem postar, queda de alcance e falhas', () => {
    const a = computeAlerts({
      ...base,
      tokenDaysLeft: 3,
      daysSinceLastPost: DEFAULT_THRESHOLDS.noPostDays,
      reachLast7: 600,
      reachPrev7: 1000,
      failuresLast24h: 1,
      syncError: 'x',
    });
    assert.deepEqual(a.map((x) => x.code).sort(), ['no-post', 'publish-failed', 'reach-drop', 'sync', 'token']);
  });

  it('queda abaixo do limite não alerta', () => {
    assert.equal(computeAlerts({ ...base, reachLast7: 800, reachPrev7: 1000 }).length, 0);
  });
});

describe('cyclePhase', () => {
  const at = (d: string) => new Date(`${d}T15:00:00`);
  it('divide 10 dias em pesquisa, testes e análise', () => {
    assert.deepEqual(cyclePhase('2026-10-01', at('2026-10-01')), { day: 1, phase: 'pesquisa' });
    assert.equal(cyclePhase('2026-10-01', at('2026-10-04')).phase, 'testes');
    assert.equal(cyclePhase('2026-10-01', at('2026-10-08')).phase, 'analise');
    assert.equal(cyclePhase('2026-10-01', at('2026-10-11')).phase, 'encerrado');
    assert.equal(cyclePhase('2026-10-05', at('2026-10-01')).phase, 'futuro');
  });
});

describe('toCsv', () => {
  it('gera CSV com BOM, ponto e vírgula, decimal com vírgula e escape', () => {
    const csv = toCsv([{ a: 'x;y', b: 1.5, c: null }], [
      { key: 'a', label: 'A' },
      { key: 'b', label: 'B' },
      { key: 'c', label: 'C' },
    ]);
    assert.equal(csv, '﻿A;B;C\r\n"x;y";1,5;');
  });
});
