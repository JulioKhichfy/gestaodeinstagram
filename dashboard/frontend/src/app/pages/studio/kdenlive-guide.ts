// Guia rápido do Kdenlive mostrado no Estúdio. Conteúdo conferido na documentação oficial (docs.kdenlive.org) em
// out/2026; os nomes dos menus podem variar um pouco conforme a versão.

export interface KdenliveItem {
  name: string;
  what: string;
  where?: string;
}

export interface KdenliveSection {
  title: string;
  highlight?: boolean;
  items: KdenliveItem[];
}

export const KDENLIVE_GUIDE: KdenliveSection[] = [
  {
    title: 'Legendas (o mais importante para o Instagram)',
    highlight: true,
    items: [
      {
        name: 'Legendagem automática (fala para texto)',
        what: 'O Kdenlive escuta o vídeo e escreve as legendas sozinho, em português, com os tempos certos. Depois é só corrigir as palavras.',
        where: 'Configure uma vez em Configurações › Configurar Kdenlive › Fala para texto (escolha Whisper e baixe o modelo de português). Depois: abra a faixa de legendas › ícone de reconhecimento de fala › escolha o modelo › Processar.',
      },
      {
        name: 'Faixa de legendas',
        what: 'Uma trilha só para legendas, acima do vídeo. Cada legenda é um bloco que você arrasta e estica para acertar o tempo.',
        where: 'Botão "Adicionar legenda" na barra da linha do tempo (ou Shift+S); dois cliques na faixa para escrever.',
      },
      {
        name: 'Estilo das legendas',
        what: 'Fonte, tamanho, cor, contorno e posição. Para Instagram: letras grandes, brancas com contorno preto, longe da parte de baixo (onde ficam os botões).',
        where: 'Sequência › Legendas › Gerenciar legendas › Estilos.',
      },
      {
        name: 'Importar e exportar .srt',
        what: 'Exporte o .srt para guardar ou para queimar no vídeo pelo Estúdio; importe um .srt pronto para ajustar.',
        where: 'Sequência › Legendas › Importar arquivo de legenda / Exportar arquivo de legenda.',
      },
      {
        name: 'Editor de fala',
        what: 'Transcreve um clipe e deixa cortar o vídeo pelo texto: apagar uma frase escrita tira aquele trecho.',
        where: 'Exibir › Editor de fala › Transcrever.',
      },
      {
        name: 'Traduzir',
        what: 'Com o Whisper, dá para gerar a legenda já traduzida para o inglês.',
        where: 'Na janela de Legendagem automática: "Traduzir para o inglês".',
      },
    ],
  },
  {
    title: 'Começar o projeto certo',
    items: [
      {
        name: 'Projeto vertical (Reels e Story)',
        what: 'Define o tamanho do vídeo final: 1080x1920, 30 quadros por segundo. Faça isso antes de montar.',
        where: 'Projeto › Configurações do projeto › perfil vertical 1080x1920, 30 fps.',
      },
      {
        name: 'Clipes proxy',
        what: 'Cria cópias leves dos vídeos só para editar sem travar; o vídeo final sai na qualidade original.',
        where: 'Projeto › Configurações do projeto › Proxy (ou clique com o botão direito no clipe › Proxy).',
      },
    ],
  },
  {
    title: 'Cortar e montar',
    items: [
      { name: 'Linha do tempo', what: 'Onde você arrasta vídeos, fotos e músicas, na ordem em que vão aparecer.' },
      { name: 'Navalha (cortar)', what: 'Corta o clipe no ponto onde você clica, para tirar pedaços ou separar cenas.', where: 'Ferramenta Navalha na barra da linha do tempo (atalho X).' },
      { name: 'Remover espaço', what: 'Depois de apagar um trecho, puxa o resto para fechar o buraco.', where: 'Botão direito no espaço vazio › Remover espaço.' },
      { name: 'Ponto de entrada e saída', what: 'Marca o começo e o fim de um trecho para cortar, exportar ou legendar só aquilo.', where: 'Teclas I (entrada) e O (saída).' },
    ],
  },
  {
    title: 'Texto e títulos',
    items: [
      { name: 'Clipe de título', what: 'Textos, formas e fundos que entram como um clipe: ganchos, chamadas, nomes.', where: 'Projeto › Adicionar clipe de título.' },
    ],
  },
  {
    title: 'Efeitos de imagem',
    items: [
      { name: 'Transformar', what: 'Muda posição, tamanho e rotação: enquadra um vídeo horizontal no formato vertical.', where: 'Efeitos › Transformar (arraste para o clipe).' },
      { name: 'Desfoque', what: 'Borra a imagem; útil como fundo atrás de um vídeo horizontal.' },
      { name: 'Correção de cor', what: 'Ajusta brilho, contraste, cores e tons (Lift/Gamma/Gain, curvas).' },
      { name: 'Velocidade', what: 'Câmera lenta ou acelerado.', where: 'Botão direito no clipe › Alterar velocidade.' },
      { name: 'Estabilizar', what: 'Reduz o tremido de vídeos gravados com a mão.' },
      { name: 'Chroma key', what: 'Tira o fundo verde e coloca outra imagem no lugar.' },
      { name: 'Quadros-chave (keyframes)', what: 'Anima qualquer ajuste ao longo do tempo (ex.: zoom que vai aumentando).' },
    ],
  },
  {
    title: 'Transições',
    items: [{ name: 'Dissolver, deslizar e outras', what: 'Passagem suave de uma cena para outra.', where: 'Sobreponha o fim de um clipe ao começo do outro e escolha a transição.' }],
  },
  {
    title: 'Áudio',
    items: [
      { name: 'Volume e ganho', what: 'Deixa a voz mais alta ou a música mais baixa.' },
      { name: 'Fade (entrada e saída)', what: 'O som começa e termina suave, sem cortes bruscos.' },
      { name: 'Normalizar (loudness)', what: 'Deixa o volume parecido em todo o vídeo.' },
      { name: 'Separar áudio', what: 'Solta o som do vídeo para editar cada um.', where: 'Botão direito no clipe › Separar áudio.' },
      { name: 'Música de fundo', what: 'Coloque a música numa trilha de áudio e baixe o volume dela.' },
    ],
  },
  {
    title: 'Exportar',
    items: [
      {
        name: 'Renderizar',
        what: 'Gera o vídeo final. Para Instagram: MP4 (H.264 com áudio AAC), no tamanho do projeto (1080x1920). Depois suba em Publicar › Reels no dashboard.',
        where: 'Projeto › Renderizar › MP4 › Renderizar para arquivo.',
      },
    ],
  },
];
