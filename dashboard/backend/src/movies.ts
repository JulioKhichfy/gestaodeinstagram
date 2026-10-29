// Central de Filmes: os menus do IMDb servem só de ROTEIRO de temas. Não lemos nem copiamos o site do IMDb (os
// termos proíbem robôs e uso comercial). Os títulos vêm de manchetes públicas (Google Notícias) nos temas atuais e
// do conhecimento do Claude nos atemporais; o Claude escreve textos originais, sem spoilers, e o Jev revisa.
import type { GenKind } from './generate.ts';
import { parseFeed } from './radar.ts';

export interface HubOption {
  id: string;
  label: string;
  /** Busca no Google Notícias para temas atuais; sem busca = tema atemporal (conhecimento do Claude). */
  query?: string;
  /** O que escolher e como escrever. */
  guide: string;
  /** O campo extra da linha (ex.: gênero) é pedido? */
  extra?: string;
}

export interface HubGroup {
  id: string;
  label: string;
  options: HubOption[];
}

/** Os 5 menus (como os do IMDb), adaptados: nada aqui vem do site deles. */
export const MOVIE_HUB: HubGroup[] = [
  {
    id: 'filmes',
    label: 'Filmes',
    options: [
      { id: 'lancamentos', label: 'Calendário de lançamento', query: 'estreias filmes cinema próximas semanas', guide: 'Filmes que estreiam nos cinemas brasileiros nas próximas semanas, com a data de estreia se as manchetes trouxerem.' },
      { id: 'top-filmes', label: '250 filmes mais bem avaliados', guide: 'Filmes aclamados de todos os tempos, consagrados pela crítica e pelo público (clássicos e modernos).' },
      { id: 'populares', label: 'Filmes mais populares', query: 'filme mais assistido semana', guide: 'Filmes que estão em alta agora (cinema ou streaming).' },
      { id: 'genero', label: 'Pesquisar filmes por gênero', guide: 'Filmes marcantes do gênero indicado.', extra: 'Gênero (ex.: suspense, comédia romântica)' },
      { id: 'bilheteria', label: 'Bilheteria de sucesso', query: 'bilheteria fim de semana cinema', guide: 'Filmes que lideram a bilheteria agora; números só se estiverem nas manchetes.' },
      { id: 'em-cartaz', label: 'Horários de exibição e ingressos', query: 'em cartaz cinemas estreias da semana', guide: 'Filmes em cartaz nos cinemas: por que ir ver no cinema. Não informe horários nem preços; convide a conferir na rede de cinema.' },
      { id: 'noticias-filmes', label: 'Notícias de filmes', query: 'cinema filme notícias Hollywood', guide: 'Notícia recente sobre um filme (elenco, produção, data, trailer). Escreva como notícia, citando a fonte.' },
      { id: 'india', label: 'Destaque do cinema indiano', query: 'Bollywood filme indiano', guide: 'Filmes indianos (Bollywood, Tollywood…) que valem a descoberta pelo público brasileiro.' },
    ],
  },
  {
    id: 'tv',
    label: 'Programas de TV',
    options: [
      { id: 'streaming', label: 'O que está passando na TV e no streaming', query: 'estreias streaming semana Netflix Prime Video Max Disney', guide: 'Séries e filmes que estreiam ou estão em alta nos streamings no Brasil; diga em qual plataforma só se as manchetes disserem.' },
      { id: 'top-series', label: 'As 250 séries mais bem avaliadas', guide: 'Séries aclamadas de todos os tempos.' },
      { id: 'series-populares', label: 'Programas de TV mais populares', query: 'série mais assistida semana', guide: 'Séries em alta agora.' },
      { id: 'series-genero', label: 'Pesquisar séries por gênero', guide: 'Séries marcantes do gênero indicado.', extra: 'Gênero (ex.: policial, comédia)' },
      { id: 'noticias-tv', label: 'Notícias de TV', query: 'série notícias temporada renovada', guide: 'Notícia recente sobre uma série (renovação, temporada, elenco). Escreva como notícia, citando a fonte.' },
    ],
  },
  {
    id: 'premios',
    label: 'Prêmios e eventos',
    options: [
      { id: 'oscar', label: 'Oscars', query: 'Oscar indicados favoritos', guide: 'Oscar: favoritos, indicados, curiosidades e história do prêmio.' },
      { id: 'gotham', label: 'Gotham Awards', query: 'Gotham Awards', guide: 'Gotham Awards (cinema independente): indicados e vencedores, se estiverem nas manchetes.' },
      { id: 'terror', label: 'Escolhas de terror (Scary Good Picks)', guide: 'Filmes de terror e suspense que dão medo de verdade, para maratonar.' },
      { id: 'halloween', label: 'Halloween em família', guide: 'Filmes de Halloween para ver em família, sem sustos pesados.' },
      { id: 'temporada', label: 'Guia de séries da temporada (Fall TV)', query: 'novas séries temporada estreias', guide: 'Novas séries e temporadas que estreiam nesta época.' },
      { id: 'aguardados', label: 'Mais aguardados do mês', query: 'filmes mais aguardados do mês', guide: 'Os lançamentos mais aguardados deste mês.' },
      { id: 'em-alta', label: 'Pessoas em alta (STARmeter)', query: 'ator atriz em alta Hollywood', guide: 'Atores e atrizes em evidência agora e por quê (trabalho recente).' },
      { id: 'premiacoes', label: 'Central de prêmios', query: 'premiação cinema vencedores', guide: 'Premiações de cinema e TV (Globo de Ouro, Emmy, Bafta…): indicados e vencedores, se nas manchetes.' },
      { id: 'festivais', label: 'Central de festivais', query: 'festival de cinema Cannes Veneza Berlim Sundance Toronto Rio', guide: 'Festivais de cinema: destaques e premiados, se nas manchetes.' },
      { id: 'eventos', label: 'Todos os eventos', query: 'evento cinema lançamento pré-estreia', guide: 'Eventos de cinema e cultura pop (CCXP, pré-estreias, convenções).' },
    ],
  },
  {
    id: 'celebridades',
    label: 'Celebridades',
    options: [
      { id: 'aniversario', label: 'Nascidos hoje', guide: 'Atores, atrizes e diretores que fazem aniversário HOJE (data no assunto). Só pessoas cuja data de nascimento você conhece com segurança; senão [CONFERIR].' },
      { id: 'destaque', label: 'Pessoas em destaque', query: 'ator atriz novo filme série destaque', guide: 'Pessoas do cinema em destaque agora e por quê.' },
      { id: 'noticias-celebridades', label: 'Notícias de celebridades', query: 'celebridades Hollywood notícias', guide: 'Notícia recente de celebridade ligada a cinema ou TV (trabalho, carreira). Sem fofoca invasiva, sem vida privada.' },
    ],
  },
  {
    id: 'assistir',
    label: 'Assistir',
    options: [
      { id: 'o-que-assistir', label: 'O que assistir', guide: 'Recomendações certeiras para hoje à noite, variando gênero e época.' },
      { id: 'trailers', label: 'Trailers mais recentes', query: 'trailer divulgado novo filme', guide: 'Trailer recém-divulgado: o que ele mostra e por que animar (sem antecipar a trama além do trailer).' },
      { id: 'bastidores', label: 'Originais: bastidores e curiosidades', guide: 'Curiosidades de bastidores de filmes conhecidos (sem spoilers).' },
      { id: 'escolhas', label: 'Escolhas da semana', guide: 'Seleção da casa: joias escondidas e filmes subestimados.' },
      { id: 'destaques', label: 'Destaques', query: 'estreia destaque cinema streaming semana', guide: 'O destaque da semana em cinema ou streaming.' },
      { id: 'familia', label: 'Guia de entretenimento para a família', guide: 'Filmes e séries para ver em família, com a faixa etária indicada.' },
      { id: 'podcasts', label: 'Podcasts de cinema', guide: 'Podcasts brasileiros e estrangeiros sobre cinema e séries que valem a escuta.' },
    ],
  },
];

export function findOption(groupId: string, optionId: string): { group: HubGroup; option: HubOption } | null {
  const group = MOVIE_HUB.find((g) => g.id === groupId);
  const option = group?.options.find((o) => o.id === optionId);
  return group && option ? { group, option } : null;
}

export interface HubRow {
  group: string;
  option: string;
  kind: GenKind;
  qty: number;
  /** Gênero (opções com `extra`) ou títulos que a pessoa quer (separados por vírgula). */
  extra?: string;
}

export const HUB_MAX_POSTS = 20;

/** Manchetes recentes de uma opção (Google Notícias, últimos 14 dias). Falha vira lista vazia. */
export async function headlines(query: string, fetcher: (url: string) => Promise<string>, now = Date.now()): Promise<string[]> {
  try {
    const url = `https://news.google.com/rss/search?${new URLSearchParams({ q: `${query} when:14d`, hl: 'pt-BR', gl: 'BR', ceid: 'BR:pt-419' })}`;
    return parseFeed(await fetcher(url), 'Google Notícias')
      .filter((i) => now - Date.parse(i.published) < 14 * 86_400_000)
      .slice(0, 20)
      .map((i) => `${i.title} (${i.source})`);
  } catch {
    return [];
  }
}

/** O Claude escolhe os títulos de uma linha (sem repetir os já escolhidos). */
export function planPrompt(group: HubGroup, option: HubOption, row: HubRow, news: string[], taken: string[], today: string): string {
  return `# Tarefa
Escolha ${row.qty} assunto(s) para posts da categoria "${group.label} › ${option.label}" de uma página brasileira de cinema e séries no Instagram.
Hoje é ${today}.
O que escolher: ${option.guide}
${row.extra ? `Indicação de quem pediu: ${row.extra}\n` : ''}${news.length ? `\nManchetes recentes (use para saber o que é atual; os fatos atuais devem vir daqui):\n${news.map((n) => `- ${n}`).join('\n')}\n` : ''}${taken.length ? `\nNão repita: ${taken.join('; ')}\n` : ''}
Responda SOMENTE com um JSON válido, sem texto antes ou depois:
[{"titulo": "título no Brasil (ano) ou nome da pessoa/evento", "angulo": "o ângulo do post em uma linha", "fonte": "veículo da manchete usada, ou vazio"}]`;
}

export interface PlannedSubject {
  title: string;
  angle: string;
  source: string;
}

export function parsePlan(text: string, max: number): PlannedSubject[] {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  let list: unknown;
  try {
    list = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error('O Claude não devolveu a lista de títulos no formato esperado. Tente de novo.');
  }
  return (Array.isArray(list) ? list : [])
    .filter((x): x is { titulo: string; angulo?: string; fonte?: string } => typeof x?.titulo === 'string' && !!x.titulo.trim())
    .slice(0, max)
    .map((x) => ({ title: x.titulo.trim(), angle: String(x.angulo ?? '').trim(), source: String(x.fonte ?? '').trim() }));
}

/** Regras de cada post: sem spoiler, fatos com segurança, notícia com fonte. */
export function movieBrief(group: HubGroup, option: HubOption, s: PlannedSubject, news: string[]): string {
  return [
    `Categoria: ${group.label} › ${option.label}`,
    `Assunto: ${s.title}${s.angle ? ` (${s.angle})` : ''}`,
    news.length ? `Manchetes recentes sobre o tema (fatos atuais só daqui; não copie frases):\n${news.slice(0, 8).map((n) => `- ${n}`).join('\n')}` : '',
    'Regras deste post:',
    '- SEM SPOILERS: conte só a premissa (quem, onde, qual o conflito, o clima) e por que vale assistir. Nunca revele final, reviravoltas, mortes ou identidade de vilões.',
    '- Fatos (ano, direção, elenco, prêmios, notas, datas, números) só se tiver certeza; se não tiver, escreva [CONFERIR] ao lado.',
    '- Não apresente rankings ou notas de sites como dado oficial (pode dizer "um dos mais bem avaliados de todos os tempos").',
    s.source ? `- Notícia: escreva com as suas palavras e termine com "Fonte: ${s.source}".` : '',
    '- Não use o nome IMDb como se a página fosse dele; a página é independente.',
  ]
    .filter(Boolean)
    .join('\n');
}
