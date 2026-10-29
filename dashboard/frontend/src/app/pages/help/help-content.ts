// Conteúdo da página de Ajuda. Linhas que começam com "- " viram itens de lista.
// Fatos técnicos conferidos na documentação da Meta em out/2026; dicas de algoritmo vêm de declarações
// públicas do Instagram e de boas práticas de mercado (o algoritmo muda: trate como direção, não como lei).

export interface HelpItem {
  q: string;
  a: string[];
}

export interface HelpSection {
  id: string;
  title: string;
  intro?: string;
  items: HelpItem[];
}

export const HELP: HelpSection[] = [
  {
    id: 'comecar',
    title: 'Primeiros passos',
    items: [
      {
        q: 'Como o dashboard funciona?',
        a: [
          'Ele roda no seu computador (backend na porta 3000 e tela em http://localhost:4300). Cada conta tem uma aba com: Publicar, Rascunhos, Relatórios, Posts e experimentos, Ciclos de 10 dias, Tráfego pago e Descoberta.',
          'Para conectar e publicar, o túnel (ngrok) precisa estar ligado: o Instagram baixa as fotos/vídeos por ele. Para ver relatórios e escrever rascunhos, basta o "npm run dev".',
        ],
      },
      {
        q: 'Como conectar uma conta?',
        a: [
          'Na aba da conta, clique em "Conectar Instagram". A tela oficial do Instagram abre; entre com a conta daquela aba. O dashboard nunca vê nem guarda sua senha do Instagram, só uma chave de acesso criptografada.',
          'Se entrar com a conta errada, o dashboard recusa e avisa. Saia do instagram.com no navegador e tente de novo.',
        ],
      },
      {
        q: 'Apareceu "Reconecte esta conta". Por quê?',
        a: [
          'A versão 2 lê métricas (alcance, salvamentos, público...). Isso exige a permissão "instagram_business_manage_insights", que não foi pedida na primeira conexão. Clique em "Reconectar" uma vez em cada conta.',
        ],
      },
      {
        q: 'O que significa "manter conectado"?',
        a: [
          '- No dashboard: a sessão dura 30 dias neste navegador (sem marcar, dura até fechar a aba / 12h).',
          '- No Instagram: o acesso vale 60 dias e o backend renova sozinho a cada 6h enquanto estiver rodando. Se ficar ~2 meses sem abrir, clique em "Reconectar".',
        ],
      },
      {
        q: 'Quando os números são atualizados?',
        a: [
          'O backend sincroniza todas as contas ao iniciar e depois a cada 6 horas. Você pode forçar em "Sincronizar" (na conta) ou "Sincronizar todas" (Visão geral).',
          'A primeira sincronização traz até 1 ano de posts e 28 dias de métricas diárias. A Meta pode atrasar dados em até 48h, por isso os últimos 3 dias são sempre recalculados.',
          'O número de seguidores é registrado a cada sincronização: o gráfico de crescimento fica mais rico com o passar dos dias.',
        ],
      },
    ],
  },
  {
    id: 'publicar',
    title: 'Publicar: formatos e medidas',
    items: [
      {
        q: 'Quais formatos posso publicar pelo dashboard?',
        a: [
          '- Post estático: 1 imagem.',
          '- Carrossel: de 2 a 20 imagens e/ou vídeos (limite atual da API).',
          '- Reels: 1 vídeo, com capa opcional, opção de aparecer no feed, Trial Reels e nome do áudio original.',
          'Stories ainda não são publicados pelo dashboard (use o app).',
        ],
      },
      {
        q: 'Qual tamanho de imagem usar?',
        a: [
          '- Feed: de 4:5 (retrato, 1080×1350 px, o mais recomendado por ocupar mais tela) até 1.91:1 (paisagem). Quadrado 1080×1080 também funciona.',
          '- A grade do perfil mostra miniaturas em 3:4: deixe o assunto principal no centro.',
          '- A API aceita apenas JPEG. PNG/WebP são convertidos automaticamente. Fotos HEIC do iPhone não abrem no navegador: exporte como JPEG.',
          '- No carrossel, todos os itens são cortados na proporção do primeiro.',
        ],
      },
      {
        q: 'E o vídeo de Reels?',
        a: [
          '- Vertical 9:16 (1080×1920), MP4 ou MOV (H.264 + áudio AAC é o mais seguro).',
          '- Deixe textos e rostos longe das bordas de cima e de baixo (onde ficam legenda e botões).',
          '- O Instagram processa o vídeo antes de publicar: pode levar alguns minutos. Não feche a página.',
        ],
      },
      {
        q: 'O que é Trial Reels?',
        a: [
          'Um Reels de teste mostrado primeiro só para quem não te segue. Ótimo para testar ganchos sem "gastar" o feed dos seguidores. Pelo dashboard ele é publicado em modo manual: depois você decide no app se ele vai também para os seguidores.',
        ],
      },
      {
        q: 'Posso colocar música do Instagram pelo dashboard?',
        a: [
          'Não: a API não adiciona músicas da biblioteca do Instagram. O som precisa estar no próprio vídeo (narração, som ambiente ou trilha livre de direitos). Você pode dar um nome ao "áudio original".',
          'Se quiser usar um áudio em alta da biblioteca, publique aquele Reels pelo app e registre-o depois no dashboard (ele aparece após a sincronização).',
        ],
      },
      {
        q: 'Quantas hashtags usar?',
        a: [
          'Hashtags hoje ajudam pouco no alcance. Use de 3 a 5 bem específicas do nicho. O dashboard avisa acima de 5 (há relatos de limite de 5 desde dez/2025, mas as fontes divergem) e bloqueia acima de 30.',
          'Mais importante: palavras-chave no texto da legenda (o que a pessoa digitaria na busca), por exemplo "decoração de consultório", "kit de aromaterapia", "livro de crônicas".',
        ],
      },
      {
        q: 'Existe limite de publicações?',
        a: ['A Meta limita publicações via API a cerca de 100 por conta a cada 24h (carrossel conta como 1). O uso aparece no topo da conta.'],
      },
    ],
  },
  {
    id: 'algoritmo',
    title: 'Como usar o algoritmo a seu favor',
    intro:
      'Não existe "um" algoritmo: Feed, Reels, Stories e Explorar têm classificações próprias. O que vale para todos: o Instagram tenta prever o que cada pessoa vai assistir, compartilhar, salvar e comentar.',
    items: [
      {
        q: 'Quais sinais pesam mais?',
        a: [
          'Segundo o chefe do Instagram (Adam Mosseri, jan/2025), os três sinais mais importantes são:',
          '- Tempo assistido (retenção): principalmente em Reels. Se as pessoas param de assistir nos 3 primeiros segundos, o vídeo não é mostrado para mais gente.',
          '- Envios por alcance (compartilhamentos por DM): o sinal mais forte para chegar a quem ainda não te segue.',
          '- Curtidas por alcance: pesa mais para quem já te segue.',
          'Salvamentos e comentários com conversa real também contam muito. Por isso o score do dashboard pondera compartilhar > salvar > comentar > curtir > visitar perfil (pesos ajustáveis em Configurações).',
        ],
      },
      {
        q: 'O que fazer na prática?',
        a: [
          '- Gancho nos 3 primeiros segundos (falado e escrito na tela). Use o Claude para gerar 10 opções e teste com Trial Reels.',
          '- Faça conteúdo que alguém queira mandar para outra pessoa ("manda pra quem precisa ver isso").',
          '- Faça conteúdo que mereça ser salvo: listas, passo a passo, checklists, antes e depois com explicação.',
          '- Termine com uma chamada para ação clara e única (salve, comente uma palavra, chame no direct).',
          '- Responda comentários na primeira hora: aumenta a conversa e a distribuição.',
          '- Seja original: o Instagram reduz a distribuição de conteúdo repostado e de vídeos com marca d\'água de outras redes.',
          '- Constância vence intensidade: 3 a 5 posts por semana, com pelo menos 2 Reels, é um bom ritmo.',
          '- Publique 30 a 60 minutos antes do pico de seguidores online (gráfico em Relatórios).',
          '- Faça posts em colaboração (Collab) com parceiros: aparece para os dois públicos.',
        ],
      },
      {
        q: 'Qual formato usar para cada objetivo?',
        a: [
          '- Alcançar gente nova: Reels (e Trial Reels para testar).',
          '- Gerar salvamentos e autoridade: carrossel educativo.',
          '- Vender: carrossel de produto/serviço com prova social + Reels mostrando o produto em uso ou o antes e depois.',
          '- Relacionamento com quem já segue: Stories (enquetes, caixinhas, bastidores).',
        ],
      },
      {
        q: 'O que evitar?',
        a: [
          '- Comprar seguidores ou usar apps de "ganhar seguidores": derruba o engajamento e pode punir a conta.',
          '- Pedir para entrar em "grupos de engajamento".',
          '- Excesso de hashtags genéricas (#love, #instagood).',
          '- Apagar e repostar o mesmo conteúdo várias vezes.',
          '- Julgar um formato com 1 post: espere 3+ posts para concluir (veja Experimentos).',
        ],
      },
    ],
  },
  {
    id: 'metricas',
    title: 'Glossário de métricas',
    items: [
      {
        q: 'Alcance x Visualizações',
        a: [
          '- Alcance: quantas contas diferentes viram o conteúdo (estimado pela Meta).',
          '- Visualizações: quantas vezes o conteúdo foi exibido/reproduzido (substituiu "impressões" em 2025).',
          'No relatório da conta, o alcance do período é a soma diária: uma mesma pessoa pode contar em dias diferentes.',
        ],
      },
      {
        q: 'Interações e contas engajadas',
        a: ['Interações somam curtidas, comentários, salvamentos, compartilhamentos e repostagens. Contas engajadas são quantas contas diferentes interagiram.'],
      },
      {
        q: 'Score do dashboard',
        a: [
          'Score = (compartilhamentos×5 + salvamentos×4 + comentários×3 + curtidas×1 + visitas ao perfil×0,5) ÷ alcance × 100.',
          'Como é dividido pelo alcance, compara posts pequenos e grandes e contas de tamanhos diferentes. Clique num post em "Posts e experimentos" para ver de onde veio o score.',
        ],
      },
      {
        q: 'Engajamento (%)',
        a: ['Interações ÷ alcance do post × 100. Como referência geral: acima de 3-5% é bom para a maioria dos nichos, mas compare sempre com a média da própria conta.'],
      },
      {
        q: 'Tempo médio assistido',
        a: ['Só para Reels: quantos segundos, em média, as pessoas assistiram. Compare com a duração do vídeo: se é muito menor, o gancho ou o ritmo precisam melhorar.'],
      },
      {
        q: 'Por que não vejo idade, cidade ou horário online?',
        a: [
          'A Meta só fornece público (idade, gênero, cidade, país) e seguidores online para contas com 100+ seguidores, e "público engajado" com 100+ interações no período.',
          'Carrosséis têm métricas apenas do álbum inteiro, não de cada imagem.',
        ],
      },
    ],
  },
  {
    id: 'relatorios',
    title: 'Relatórios',
    items: [
      {
        q: 'Estratégico x Operacional',
        a: [
          '- Estratégico: para decidir O QUE postar. Crescimento, alcance, sinais por semana, score por formato e dia da semana, horários, melhores/piores posts, público e "Leituras automáticas".',
          '- Operacional: para garantir que a máquina está funcionando. Dias sem postar, frequência, acesso, sincronização, alertas e histórico de publicações.',
        ],
      },
      {
        q: 'Como ler o gráfico de sinais por semana?',
        a: ['Cada barra é uma semana de posts. Se a parte de compartilhamentos e salvamentos cresce, o conteúdo está ficando mais "recomendável". Se só as curtidas crescem, o alcance tende a ficar preso nos seguidores atuais.'],
      },
      {
        q: 'Posso ver os números exatos dos gráficos?',
        a: ['Sim: clique em "Ver tabela" no canto do gráfico. Para levar para o Excel, use "Exportar CSV" (abre direto no Excel em português).'],
      },
      {
        q: 'Como comparar as contas?',
        a: ['Na "Visão geral": tabela lado a lado com variação em relação ao período anterior, alcance diário de todas as contas e score médio por conta. Os alertas de todas as contas aparecem no topo.'],
      },
      {
        q: 'Quais alertas existem?',
        a: [
          '- Conta desconectada ou acesso perto de expirar.',
          '- Muitos dias sem postar.',
          '- Queda de alcance da última semana em relação à anterior.',
          '- Falha de publicação nas últimas 24h ou erro de sincronização.',
          'Os limites são ajustáveis em Configurações.',
        ],
      },
    ],
  },
  {
    id: 'experimentos',
    title: 'Experimentos e ciclos de 10 dias',
    items: [
      {
        q: 'Como registrar um experimento?',
        a: [
          'Em "Posts e experimentos", clique no post e preencha gancho (ex.: pergunta, número/lista, erro comum), estilo (educativo, bastidores, prova social...) e pilar de conteúdo. O quadro "O que funciona melhor" ranqueia as combinações pelo score médio.',
          'Dica: registre também nos rascunhos, antes de postar, para não esquecer.',
        ],
      },
      {
        q: 'Como funciona o ciclo de 10 dias?',
        a: [
          '- Dias 1-3 (Pesquisa): revise o relatório, veja referências do nicho e defina 2 hipóteses (ex.: "carrossel com gancho de erro comum gera mais salvamentos").',
          '- Dias 4-7 (Testes): publique as variações e registre gancho/estilo de cada uma.',
          '- Dias 8-10 (Análise): compare os scores, escolha a vencedora, decida se algo merece impulsionamento e planeje o próximo ciclo.',
          'O ciclo mostra metas, checklist, resultado comparado aos 10 dias anteriores e anotações.',
        ],
      },
      {
        q: 'Quantos posts preciso para concluir algo?',
        a: ['Pelo menos 3 posts por combinação. Com 1 post, sorte e horário pesam mais que o formato.'],
      },
    ],
  },
  {
    id: 'claude',
    title: 'Rascunhos e assistente Claude',
    items: [
      {
        q: 'Como usar o Claude no dashboard?',
        a: [
          'Em Publicar (legenda), Rascunhos (qualquer artefato), Relatórios (análise) e Tráfego pago há o campo "Pedir ao Claude". Escolha o tipo (legenda, roteiro de Reels, textos do carrossel, ganchos, hashtags, som, ideias, análise...), escreva detalhes se quiser e clique em "Pedir ao Claude".',
          'A resposta pode substituir o texto, ser adicionada ao final ou copiada. Nos rascunhos, a conversa fica salva e o Claude lembra das versões anteriores.',
        ],
      },
      {
        q: 'O que o Claude sabe sobre a conta?',
        a: [
          '- O arquivo claude.md da pasta da conta (objetivo, público, tom de voz, pilares). Quanto mais completo, melhores as respostas: preencha tom de voz, produtos/serviços, preços e links.',
          '- Os posts com melhor desempenho e o score por formato.',
          '- O texto atual do artefato.',
          'Ele não inventa preços ou promessas: quando faltar informação, deixa [colchetes] para você preencher.',
        ],
      },
      {
        q: 'Usa minha assinatura do Claude? Tem custo extra?',
        a: [
          'Usa a sua assinatura por meio do Claude Code instalado neste computador, sem chave de API e sem cobrança extra. Os pedidos contam no limite de uso da sua assinatura.',
          'O Claude roda sem nenhuma ferramenta (não lê arquivos nem navega): só recebe o texto e devolve o texto.',
        ],
      },
      {
        q: 'Boas formas de pedir',
        a: [
          '- "Roteiro de 30s mostrando o kit aromático em uso, tom acolhedor, CTA para chamar no direct."',
          '- "10 ganchos para um carrossel sobre erros de layout em consultório odontológico."',
          '- "Melhore: deixe mais curto e com uma pergunta no final."',
          '- "Ideias para a semana do lançamento do livro, misturando bastidores e trechos."',
        ],
      },
    ],
  },
  {
    id: 'filmes',
    title: 'Central de Filmes',
    intro:
      'Contas com "hub": "filmes" ganham a aba Central de Filmes. Os menus (Filmes, Programas de TV, Prêmios e eventos, Celebridades, Assistir) são só o roteiro de temas: nada é lido nem copiado do IMDb, cujos termos proíbem robôs e uso comercial.',
    items: [
      {
        q: 'Como usar?',
        a: [
          'Cada linha tem quantidade, formato (Post, Carrossel, Reels ou Story), menu e opção. A tela já abre com uma linha por formato: é só preencher as quantidades (até 20 posts por vez). O campo ao lado serve para o gênero ou para títulos que você queira.',
          'O Claude escolhe os títulos de cada linha sem repetir. Nas opções com 📰 ele usa as manchetes atuais do Google Notícias; nas outras, o próprio conhecimento. Depois escreve cada post, o Jev revisa e tudo vira rascunho.',
        ],
      },
      {
        q: 'Regras dos textos',
        a: [
          '- Sem spoilers: só a premissa e por que vale assistir.',
          '- Fatos de que o Claude não tem certeza saem com [CONFERIR]: cheque antes de publicar.',
          '- Notícia sai com as próprias palavras e "Fonte: veículo".',
          '- Limites: legenda até 1.500 caracteres (o Instagram aceita 2.200), slide até 220, tela de Story até 120. Se passar, o Claude encurta.',
          'São só textos: monte as imagens com o card de texto do editor ou artes próprias.',
        ],
      },
    ],
  },
  {
    id: 'radar',
    title: 'Radar e Raio-X (páginas de tema, como um clube)',
    intro:
      'Contas com "radar" no arquivo de contas ganham duas abas: Radar (notícias quentes do tema) e Raio-X (conteúdo histórico em séries). Foram pensadas para páginas como a do Flamengo, e servem para qualquer tema (outro clube, um artista, uma cidade).',
    items: [
      {
        q: 'Como o Radar decide o que está quente?',
        a: [
          '- A cada 10 minutos (com o dashboard aberto no PC) ele lê as fontes configuradas: Google Notícias, ge, Coluna do Fla, ESPN, UOL…',
          '- Junta a mesma notícia publicada por vários veículos. Quente = 3 ou mais veículos nas últimas 6 horas, ou fato de última hora muito relevante.',
          '- O Jev classifica o tipo (última hora, mercado, jogo, bastidores, opinião, história) e se é Confirmado ou Rumor.',
        ],
      },
      {
        q: 'O que acontece em "Criar post"?',
        a: [
          'O Claude escreve um post com as próprias palavras, só com os fatos das manchetes, e termina com "Fonte: veículo". Se o Jev achar que é rumor, o post diz que não está confirmado. O Jev revisa a legenda e o resultado vira rascunho para você conferir e publicar.',
          'Velocidade importa, mas credibilidade importa mais: confira o rascunho antes de postar, principalmente em notícias de mercado.',
        ],
      },
      {
        q: 'E o Raio-X?',
        a: [
          'Escolha uma série (linha do tempo, ídolos, jogos históricos, gols, títulos, curiosidades…), clique em "Sugerir pautas", marque as que quiser e gere. O Claude marca [CONFERIR] em datas, placares e nomes de que não tem certeza: cheque esses pontos antes de publicar. Frases de entrevista só são citadas quando foram publicadas, com quem disse e onde.',
        ],
      },
      {
        q: 'E as fotos e vídeos?',
        a: [
          'Fotos de jogos, de agências, da TV e do site do clube têm dono: usá-las sem autorização pode derrubar posts e a conta. Prefira artes com texto e números (o "card de texto" do editor), fotos suas ou material com licença livre. Por isso o Radar não sugere fotos de banco de imagens nas notícias.',
        ],
      },
      {
        q: 'Como criar o Radar para outro tema (ex.: Milan)?',
        a: [
          'No arquivo de contas, copie o bloco "radar" da conta do Flamengo para a conta nova e troque o tema, as palavras e as fontes (Google Notícias aceita qualquer busca, ex.: q=AC+Milan&hl=it). Reinicie o dashboard.',
        ],
      },
    ],
  },
  {
    id: 'clientes',
    title: 'Captar clientes',
    intro:
      'A aba "Captar clientes" junta, dos comentários dos seus posts, quem quer comprar ou contratar. Responder rápido é o que mais converte: quem pergunta o preço e não tem resposta compra de outra pessoa.',
    items: [
      {
        q: 'Como o dashboard separa os interessados?',
        a: [
          '- Lê os comentários dos posts dos últimos 60 dias (sozinho a cada 6 h, ou no botão "Buscar comentários agora").',
          '- Uma regra de palavras pega o óbvio: "quanto custa", "orçamento", "como compro", "parcela", "me chama no direct"…',
          '- O Jev lê cada comentário com o perfil do negócio (claude.md) e diz a intenção (comprar, dúvida, elogio, crítica, spam), a chance de interesse e se é urgente.',
          'Elogios e spam não entram na lista (estão em "Todos os comentários"). Os urgentes e sem resposta aparecem primeiro.',
        ],
      },
      {
        q: 'Como responder?',
        a: [
          '- "Responder" abre o campo; "Sugerir com o Claude" escreve uma resposta curta no tom da conta, que você edita.',
          '- "Responder no Instagram" publica a resposta no comentário (pede confirmação). O interessado vai para "Em conversa".',
          '- "Abrir direct" abre a conversa com a pessoa no Instagram; a mensagem é escrita e enviada por você.',
          'O dashboard nunca manda mensagem, segue ou curte sozinho: isso viola as regras da Meta e pode bloquear a conta.',
        ],
      },
      {
        q: 'Como medir o resultado?',
        a: [
          'Mude o status de cada interessado (Novo › Em conversa › Cliente ou Descartado) e registre o valor fechado. O topo mostra interessados, sem resposta, clientes, valor e conversão dos últimos 30 dias, e a tabela mostra quais posts mais trazem clientes: faça mais parecidos e impulsione esses.',
        ],
      },
      {
        q: 'Aparece "Falta uma permissão"',
        a: [
          'Ler e responder comentários exige a permissão de comentários da Meta, que as conexões antigas não têm. Na página da conta, clique em "Conectar pelo Facebook" (ou Reconectar) e aceite tudo. Se a Página estiver num Gerenciador de Negócios, a Meta pode pedir também a permissão de anúncios (ads_read).',
        ],
      },
    ],
  },
  {
    id: 'gerar',
    title: 'Gerar posts com Claude + Jev',
    intro:
      'Em Rascunhos › "＋ Gerar posts", escreva o tema de 1 a 10 posts (post estático, carrossel ou Reels) e clique em Gerar. Nada é publicado sozinho: cada post vira um rascunho para você revisar e decidir.',
    items: [
      {
        q: 'O que acontece em cada post?',
        a: [
          '- O Claude escreve título, legenda e, conforme o formato, os textos dos slides ou o roteiro do Reels.',
          '- O Jev dá a nota da legenda. Abaixo de 75, as dicas dele viram instrução e o Claude reescreve (até 2 vezes). Fica a versão com a maior nota.',
          '- Os bancos de imagens gratuitos configurados (Unsplash e Pixabay) sugerem fotos (carrossel e post) ou vídeos (Reels, só Pixabay, verticais primeiro), e o Jev ordena pelo quanto combinam com o tema.',
          'O Jev não escreve texto: ele avalia. Quem reescreve é o Claude, guiado pela avaliação do Jev.',
        ],
      },
      {
        q: 'Como escolher as fotos e vídeos?',
        a: [
          'No rascunho, clique nas miniaturas para marcar o que vai no post (no carrossel, várias). O número no canto é o quanto o Jev acha que a mídia combina com o tema.',
          'Em "Levar para publicação", as mídias marcadas entram no editor sozinhas. Lá você ainda reordena, troca ou adiciona as suas.',
          'As fotos e vídeos do Unsplash e do Pixabay são gratuitos, inclusive para uso comercial. Dê crédito ao autor quando puder (o nome está nas anotações do rascunho). As fotos do Pixabay ficam guardadas no seu PC (regra deles); as do Unsplash são baixadas na hora de publicar e o Unsplash é avisado (regra deles). Todas entram no post cortadas para 4:5.',
        ],
      },
      {
        q: 'Como publicar vídeos (Reels)?',
        a: [
          '- Vídeo seu: em Publicar › Reels, envie um MP4 ou MOV vertical (9:16), de 3 segundos a 15 minutos. Peça o roteiro ao Claude antes de gravar.',
          '- Vídeo de banco: gere um post do tipo Reels; o rascunho traz vídeos do Pixabay (até 90 s, verticais primeiro) e o roteiro. Vídeos horizontais aparecem com faixas no Reels.',
          'A API não coloca música da biblioteca do Instagram: o som precisa estar no próprio vídeo. Para usar um áudio em alta, publique pelo app do Instagram.',
          'Publicar exige o túnel aberto (o Instagram baixa o vídeo do seu PC) e pode levar alguns minutos enquanto o Instagram processa.',
        ],
      },
    ],
  },
  {
    id: 'jev',
    title: 'Revisão e classificação com o Jev',
    intro:
      'O Jev (TypeSafe AI) é um modelo de IA feito para avaliar, não para escrever: lê um texto e responde perguntas fechadas (nota, categoria, sim/não) em menos de um segundo. Divisão de trabalho: o Claude escreve, o Jev confere.',
    items: [
      {
        q: 'Revisar legenda',
        a: [
          'Em Publicar e em Rascunhos, clique em "Revisar legenda". O Jev dá uma nota de 0 a 100 somando quatro dimensões com pesos fixos:',
          '- Gancho (peso 35): a 1ª linha, que aparece antes do "mais", faz parar de rolar?',
          '- Clareza (peso 25): uma mensagem principal, fácil de ler no celular?',
          '- Chamada para ação (peso 20): pede salvar, comentar, enviar, clicar no link ou chamar no direct?',
          '- Tom da marca (peso 20): soa como o claude.md da conta descreve? Sem claude.md, essa dimensão fica de fora.',
          'Também aponta o objetivo da legenda (alcance, salvamento, conversa, venda, autoridade), o tipo de gancho e o estilo, e avisa sobre promessa exagerada ou tema sensível.',
          'Leitura da nota: 75 ou mais, pronta para publicar; de 50 a 74, dá para melhorar; abaixo de 50, precisa de ajustes. Para reescrever, use "Pedir ao Claude › Melhorar texto" e revise de novo.',
        ],
      },
      {
        q: 'O que é "Jev em dúvida"?',
        a: [
          'Cada resposta vem com a confiança do Jev. Abaixo de 50%, a tela avisa "Jev em dúvida": a avaliação pode estar errada e vale conferir com atenção.',
        ],
      },
      {
        q: 'Classificar posts nos Experimentos',
        a: [
          'Em Posts, o botão "Classificar com o Jev" lê a legenda dos posts sem registro e sugere o gancho e o estilo, até 40 posts por clique.',
          'Ele só grava quando tem confiança alta (60% ou mais). Os demais ficam para você registrar à mão.',
          'Sugestões do Jev aparecem com ◆. Ao abrir o post e salvar o registro, ele passa a valer como seu (o ◆ some).',
        ],
      },
      {
        q: 'Custo e privacidade',
        a: [
          'O Jev usa a chave de API da TypeSafe guardada no backend (TYPESAFE_API_KEY); ela nunca vai para o navegador. A cobrança é por tokens de entrada: uma revisão de legenda usa cerca de 1.500 tokens.',
          'Vão para o Jev só a legenda, o formato e o claude.md da conta. Nenhum token do Instagram nem métrica.',
        ],
      },
    ],
  },
  {
    id: 'trafego',
    title: 'Tráfego pago (impulsionar)',
    intro: 'O dashboard indica o que impulsionar, ajuda a planejar e registra os resultados. O impulsionamento em si é feito no app (Turbinar) ou no Gerenciador de Anúncios.',
    items: [
      {
        q: 'Quando vale impulsionar?',
        a: [
          '- Quando o post já foi bem no orgânico (score acima da média da conta): o anúncio aproveita um criativo validado e custa menos por resultado.',
          '- Em lançamentos e datas comerciais (lançamento de livro, turma nova, Natal, Dia das Mães...).',
          '- Para alcançar um público muito específico (ex.: donos de clínicas na sua cidade) que o orgânico não alcança.',
          'Não vale impulsionar um post que foi mal no orgânico na esperança de "salvar" o post.',
        ],
      },
      {
        q: 'Turbinar ou Gerenciador de Anúncios?',
        a: [
          '- Turbinar (no app, botão no post): rápido, bom para começar. Objetivos: visitas ao perfil, visitas ao site ou mensagens.',
          '- Gerenciador de Anúncios (adsmanager.facebook.com): mais controle (objetivos de vendas e cadastros, públicos personalizados, testes A/B). Exige Página do Facebook e conta de anúncios.',
        ],
      },
      {
        q: 'Qual objetivo escolher?',
        a: [
          '- Livros: tráfego para a página de compra do livro ou visitas ao perfil.',
          '- Cursos, palestras e mentorias: mensagens (direct/WhatsApp) ou cadastros para lista de espera.',
          '- Loja: mensagens ou visitas ao site/loja; carrosséis de produtos com preço claro.',
          '- Serviços locais: mensagens para orçamento, com público local (cidade + raio).',
        ],
      },
      {
        q: 'Como montar o público?',
        a: [
          '- Público por interesses: idade, local e interesses ligados ao nicho (sugestões na aba Tráfego pago de cada conta).',
          '- Pessoas que interagiram com seu perfil (público personalizado): ótimo para converter quem já te conhece.',
          '- Público semelhante (lookalike): parecido com quem já engaja ou compra.',
          '- Evite públicos minúsculos (anúncio fica caro) ou enormes sem filtro (dinheiro se espalha).',
        ],
      },
      {
        q: 'Quanto investir e por quanto tempo?',
        a: [
          'Comece com um teste de R$ 15 a R$ 50 por dia por 5 a 7 dias. Não altere a campanha todo dia: o sistema precisa de alguns dias para aprender. Se o custo por resultado for bom, aumente aos poucos (20-30% por vez).',
        ],
      },
      {
        q: 'Quais números acompanhar?',
        a: [
          '- Custo por resultado (mensagem, clique, venda): o principal. O dashboard calcula quando você informa gasto e resultados.',
          '- CPM (custo por mil exibições) e CPC (custo por clique): indicam se o público/criativo está caro.',
          '- Frequência: acima de ~3 a mesma pessoa está vendo demais; renove o criativo.',
        ],
      },
    ],
  },
  {
    id: 'descoberta',
    title: 'Descoberta de perfis',
    intro:
      'Encontre perfis parecidos, concorrentes e possíveis parceiros usando só o que a API oficial da Meta permite. Nada é enviado a ninguém: seguir, mandar mensagem ou propor parceria é sempre manual.',
    items: [
      {
        q: 'O que a Descoberta faz?',
        a: [
          '- Busca por palavra-chave: o termo vira hashtag (minúsculo, sem acento e sem espaço: "Decoração Afetiva" vira #decoracaoafetiva). Aparecem os posts em alta e os recentes (últimas 24h) e os perfis @mencionados nas legendas.',
          '- Sugestões: perfis que você já mencionou nos seus posts, perfis achados nas buscas e concorrentes cadastrados, ordenados por afinidade com a sua conta.',
          '- Lista salva: concorrentes e referências que você cadastrou, e perfis marcados como "Salvo" ou "Em contato", com anotações.',
        ],
      },
      {
        q: 'Por que aparecem os @mencionados, e não quem publicou o post?',
        a: [
          'A Meta não devolve o autor dos posts de hashtag (o campo username é proibido nessa consulta). Por isso o dashboard mostra o link de cada post, para você abrir e ver quem publicou, e consulta os perfis citados nas legendas.',
          'Se gostar de um autor, cadastre o @ dele na Lista salva: o dashboard passa a acompanhar os dados públicos.',
        ],
      },
      {
        q: 'O que é o limite de 30 hashtags?',
        a: [
          'A Meta permite consultar no máximo 30 hashtags diferentes a cada 7 dias por conta do Instagram. O contador mostra quantas já foram usadas e quando cada uma libera (passe o mouse na hashtag).',
          'Repetir uma hashtag já consultada na semana não gasta outra vaga, e o resultado fica guardado por 24h. Ao chegar em 30, o botão Buscar só funciona para as hashtags já consultadas.',
          'Dica: comece pelas "Suas hashtags de melhor desempenho" (aba Sugestões). São temas que já funcionam para o seu público.',
        ],
      },
      {
        q: 'Como a afinidade é calculada (0 a 100)?',
        a: [
          '- Até 45 pontos: o perfil usa hashtags que também aparecem nos seus posts de melhor score.',
          '- Até 25: você já mencionou o perfil nos seus posts.',
          '- Até 15: o perfil foi citado em posts das hashtags que você pesquisou.',
          '- 15: você o cadastrou como concorrente ou referência.',
          '- 5: postou nos últimos 30 dias.',
          'Cada card mostra os motivos. Engajamento = (curtidas + comentários) ÷ seguidores, na média dos últimos posts públicos.',
        ],
      },
      {
        q: 'Por que preciso conectar o Facebook?',
        a: [
          'Busca por hashtag e dados públicos de outros perfis (Business Discovery) só existem na "API do Instagram com login do Facebook". A conexão das abas usa o login do Instagram, que não tem esses recursos.',
          'Para funcionar, cada conta do Instagram precisa estar vinculada a uma Página do Facebook (no app do Instagram: Editar perfil › Página). Se só uma estiver vinculada, as consultas das outras saem por ela, e o limite de 30 hashtags é dessa conta.',
          '- Configuração: no mesmo app da Meta, adicione o produto "Login do Facebook para Empresas", copie o ID e a Chave secreta em Configurações › Básico para FB_APP_ID e FB_APP_SECRET no backend/.env e reinicie o backend.',
          '- Em modo Desenvolvimento, a Meta aceita o retorno em http://localhost:3000/api/facebook/callback, sem precisar do túnel.',
          '- O acesso do Facebook dura cerca de 60 dias. Depois, clique em "Reconectar" na Descoberta.',
        ],
      },
      {
        q: 'A busca por hashtag deu "A Meta recusou". E agora?',
        a: [
          'A busca por hashtag depende do recurso "Instagram Public Content Access", que a Meta costuma liberar só depois da Análise do app (App Review) e da verificação do negócio. Em modo Desenvolvimento ele pode não funcionar.',
          'Sugestões, Lista salva e dados públicos dos perfis (Business Discovery) continuam funcionando. Se quiser a busca, peça o recurso em Análise do app, explicando que o uso é encontrar conteúdo e criadores do seu nicho.',
        ],
      },
      {
        q: 'Um perfil aparece como "indisponível".',
        a: [
          'A Meta só mostra dados de contas profissionais (Empresa ou Criador) e públicas. Contas pessoais, privadas, com restrição de idade ou que mudaram de @ aparecem assim. O link para abrir no Instagram continua funcionando.',
        ],
      },
      {
        q: 'Por que o dashboard não segue nem manda mensagem automaticamente?',
        a: [
          'A API oficial não permite seguir, deixar de seguir, ver seguidores de outras contas nem mandar mensagem para quem não falou com você antes. Fazer isso por automação ou scraping viola os termos da Meta e pode bloquear as suas contas.',
          'Como fazer bem: interaja de verdade (comente com algo útil nos posts do perfil por alguns dias) antes de propor parceria no direct. Marque o status "Em contato" e anote o combinado.',
        ],
      },
    ],
  },
  {
    id: 'contas',
    title: 'Dicas por tipo de negócio',
    items: [
      {
        q: 'Autores e livros',
        a: [
          '- Reels lendo trechos curtos com legenda na tela; bastidores da escrita; reação de leitores.',
          '- Carrosséis com frases do livro (use o card de texto) e "5 motivos para ler".',
          '- Prova social: prints de mensagens de leitores (com autorização).',
          '- CTA: link da loja na bio; datas de lançamento e eventos.',
        ],
      },
      {
        q: 'Cursos, palestras e mentorias',
        a: [
          '- Carrosséis educativos para o seu público profissional (gestão, precificação, captação de clientes): geram salvamentos.',
          '- Reels com trechos de palestras e depoimentos de alunos.',
          '- Lives/aulas abertas antes de abrir turma; lista de espera por direct.',
        ],
      },
      {
        q: 'Lojas (produtos)',
        a: [
          '- Reels do produto em uso (antes e depois, montagem do kit, unboxing).',
          '- Carrosséis de produtos ou kits com preço e "como usar"; ideias de presente por data comemorativa.',
          '- Responda rápido no direct: mensagens viram vendas.',
        ],
      },
      {
        q: 'Serviços para empresas e profissionais (ex.: projetos, consultorias)',
        a: [
          '- Antes e depois com explicação das decisões tomadas.',
          '- Erros comuns do seu cliente e como resolver: conteúdo salvável e compartilhável no nicho dele.',
          '- Cases com depoimento do cliente; CTA para orçamento por mensagem; anúncios com público local.',
        ],
      },
    ],
  },
  {
    id: 'problemas',
    title: 'Problemas comuns',
    items: [
      {
        q: 'Faixa amarela "Configuração pendente"',
        a: ['Falta preencher o backend/.env (IG_APP_ID, IG_APP_SECRET, PUBLIC_BASE_URL) ou o backend não foi reiniciado depois da edição. Veja dashboard/SETUP.md.'],
      },
      {
        q: '"Invalid redirect_uri" ou "Insufficient developer role" no login',
        a: [
          '- redirect_uri: o URI cadastrado na Meta precisa ser exatamente PUBLIC_BASE_URL + /api/instagram/callback.',
          '- developer role: a conta precisa ser testadora do app e ter aceitado o convite (instagram.com › Configurações › Apps e sites).',
        ],
      },
      {
        q: 'Falha ao publicar: mídia não pôde ser baixada',
        a: ['O túnel está desligado ou o PUBLIC_BASE_URL mudou. Abra PUBLIC_BASE_URL/api/health no navegador: deve mostrar {"ok":true}.'],
      },
      {
        q: 'Relatórios vazios',
        a: [
          '- A conta foi conectada na v1? Reconecte para liberar a permissão de métricas.',
          '- Rode "Sincronizar" e aguarde. Erros aparecem em Relatórios › Operacional.',
          '- Métricas da Meta podem atrasar até 48h.',
        ],
      },
      {
        q: 'O Claude não responde',
        a: [
          '- O Claude Code precisa estar instalado e logado neste PC: abra um terminal, rode "claude" e faça login com sua assinatura.',
          '- Se aparecer limite de uso, aguarde: os pedidos contam no limite da assinatura.',
          '- Pedidos muito longos podem passar de 3 minutos: divida o pedido.',
        ],
      },
      {
        q: 'Esqueci a senha do dashboard',
        a: ['Pare o backend, apague o campo "passwordHash" de backend/data/store.json (ou o arquivo inteiro, perdendo as conexões) e abra o dashboard para criar uma nova senha.'],
      },
    ],
  },
  {
    id: 'seguranca',
    title: 'Segurança e privacidade',
    items: [
      {
        q: 'Onde ficam meus dados?',
        a: [
          'Tudo fica no seu computador, em dashboard/backend/data: banco de métricas (dashboard.db), sessões, senha (com hash) e chaves de acesso do Instagram criptografadas (AES-256-GCM) com uma chave gerada só para este PC (secret.key).',
          'Não compartilhe a pasta data nem o arquivo .env. Os tokens nunca aparecem na tela nem nas respostas da API.',
        ],
      },
      {
        q: 'O túnel expõe meu computador?',
        a: ['Ele expõe só o backend do dashboard. Por isso há senha, limite de tentativas de login e as mídias têm nomes aleatórios e são apagadas depois de publicadas. Desligue o túnel quando não estiver conectando ou publicando.'],
      },
    ],
  },
];
