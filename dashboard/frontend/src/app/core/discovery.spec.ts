import { DiscoveredProfile } from './api';
import { DEFAULT_FILTER, filterProfiles, normalizeTerm } from './discovery';

const profile = (over: Partial<DiscoveredProfile>): DiscoveredProfile => ({
  id: 1, username: 'x', profileUrl: '', source: 'hashtag', watch: false, mentionCount: 0, hashtags: [],
  available: true, error: null, followers: 5000, avgEngagement: 2, postsPerWeek: 2, niche: null,
  affinity: 10, reasons: [], status: 'novo', notes: '', fetchedAt: 0, public: null, ...over,
});

describe('discovery', () => {
  it('normaliza o termo como o backend', () => {
    expect(normalizeTerm('Decoração Afetiva!')).toBe('decoracaoafetiva');
    expect(normalizeTerm('#Arq_Saúde')).toBe('arq_saude');
  });

  it('filtra por seguidores, frequência, engajamento e disponibilidade', () => {
    const list = [
      profile({ id: 1, followers: 5000 }),
      profile({ id: 2, followers: 50_000, postsPerWeek: 4, avgEngagement: 4 }),
      profile({ id: 3, available: false, followers: null, postsPerWeek: null, avgEngagement: null }),
    ];
    const ids = (f: Partial<typeof DEFAULT_FILTER>) => filterProfiles(list, { ...DEFAULT_FILTER, ...f }).map((p) => p.id);
    expect(ids({})).toEqual([1, 2, 3]);
    expect(ids({ followers: 'micro' })).toEqual([1]);
    expect(ids({ followers: 'medio' })).toEqual([2]);
    expect(ids({ minPostsPerWeek: 3 })).toEqual([2]);
    expect(ids({ minEngagement: 3 })).toEqual([2]);
    expect(ids({ hideUnavailable: true })).toEqual([1, 2]);
  });
});
