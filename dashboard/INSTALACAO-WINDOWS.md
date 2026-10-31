# Instalar o dashboard num notebook com Windows (passo a passo)

Este guia é para quem vai **usar** o dashboard no próprio computador, mesmo sem experiência com programação.
Leva de 40 minutos a 1 hora na primeira vez. Depois, o dia a dia é **dois cliques** num atalho.

> **Não precisa de Java.** O dashboard usa Node.js (o motor), Git (para baixar e atualizar), um túnel (para publicar)
> e um assistente de IA (ChatGPT ou Claude, pela sua própria assinatura).

## O que você vai precisar

| Item | Para quê | Custo |
|---|---|---|
| Git | Baixar e atualizar o dashboard | Grátis |
| Node.js 24 | Rodar o dashboard | Grátis |
| FFmpeg | Editar vídeos e imagens na página Estúdio | Grátis |
| Kdenlive (opcional) | Acabamento fino de vídeo e ajuste de legendas | Grátis |
| cloudflared | Túnel: a Meta baixa daqui as fotos e vídeos na hora de publicar | Grátis |
| Codex (ChatGPT) **ou** Claude Code | O assistente que escreve legendas, roteiros e respostas | Sua assinatura do ChatGPT ou do Claude |
| Instagram profissional + Página do Facebook | Exigência da Meta para gerenciar a conta por um sistema | Grátis |
| App da Meta no seu nome | Permissão para o dashboard conversar com o Instagram | Grátis |

---

## Parte 1. Instalar os programas

1. Clique no menu Iniciar, digite **PowerShell** e abra o **Windows PowerShell** (não precisa ser como administrador).
2. Copie e cole **uma linha por vez**, apertando Enter depois de cada uma. Se aparecer uma pergunta sobre termos, digite
   `Y` e Enter.

```powershell
winget install -e --id Git.Git
winget install -e --id OpenJS.NodeJS.LTS --version 24.22.1
winget install -e --id Cloudflare.cloudflared
winget install -e --id Gyan.FFmpeg
winget install -e --id KDE.Kdenlive
```

3. **Feche o PowerShell e abra de novo** (para ele enxergar os programas novos) e confira:

```powershell
git --version
node -v
cloudflared --version
ffmpeg -version
```

`node -v` deve mostrar algo começando com **v24**. O dashboard foi testado no Node 24; não use o 26 por enquanto.

## Parte 2. Baixar o dashboard

No PowerShell:

```powershell
cd $HOME\Documents
git clone -b client_ff https://github.com/JulioKhichfy/gestaodeinstagram.git
cd gestaodeinstagram\dashboard
npm install
```

O `npm install` demora alguns minutos na primeira vez. O dashboard fica em
`Documentos\gestaodeinstagram\dashboard`.

## Parte 3. O assistente de IA

### Com a assinatura do ChatGPT (Codex)

O Codex é a ferramenta da OpenAI equivalente ao Claude Code, incluída nos planos pagos do ChatGPT.

```powershell
npm install -g @openai/codex
codex
```

Na primeira vez, o `codex` pergunta como entrar: escolha **Sign in with ChatGPT**. O navegador abre; entre com a sua
conta do ChatGPT e autorize. Quando o terminal mostrar que entrou, feche com **Ctrl+C**. Pronto: o dashboard usa
essa sessão.

### Quando migrar para o Claude

```powershell
npm install -g @anthropic-ai/claude-code
claude
```

Entre com a sua conta do Claude, feche com Ctrl+C, troque `AI_PROVIDER=chatgpt` por `AI_PROVIDER=claude` no arquivo
`backend\.env` (Parte 5) e abra o dashboard de novo. Nada mais muda.

## Parte 4. Instagram e Facebook

A Meta só deixa um sistema gerenciar contas **profissionais** que estejam **vinculadas a uma Página do Facebook**.
Faça os passos abaixo **para cada conta do Instagram** que vai usar no dashboard.

### 4.1 Mudar para conta profissional

No app do Instagram, no celular:
1. Abra o perfil da conta e toque no menu (☰) › **Configurações e atividade**.
2. **Tipo de conta e ferramentas** › **Mudar para conta profissional**.
3. Escolha **Criador de conteúdo** ou **Empresa** e a categoria. Se a conta já é profissional, pule.

### 4.2 Criar uma Página do Facebook (se a conta ainda não tem)

Pelo computador, em facebook.com, entrando com o **seu** Facebook:
1. Menu (☰ ou o seu nome) › **Páginas** › **Criar nova Página**.
2. Nome (pode ser o mesmo da conta do Instagram), categoria e uma descrição curta › **Criar Página**.
3. Os próximos passos (foto, convidar amigos) podem ser pulados.

Ou pelo app do Instagram: **Editar perfil** › **Página** › **Criar Página do Facebook**.

### 4.3 Vincular a conta do Instagram à Página

No app do Instagram: **Editar perfil** › **Página** › **Conectar uma Página existente** › escolha a Página › Concluir.

> **Atenção:** estar ligado pela **Central de Contas** (mesmo login no Facebook e no Instagram) **não é o mesmo**.
> O dashboard só enxerga a conta se ela aparecer em **Editar perfil › Página**.

### 4.4 Criar o seu app da Meta

O dashboard conversa com o Instagram por meio de um "app" cadastrado na Meta, no **seu** nome. É grátis e você não
precisa publicar o app: ele fica em **modo Desenvolvimento**, em que só você (a criadora) consegue entrar, sem precisar
da análise da Meta. Faça tudo no computador, com o seu Facebook.

**1. Virar desenvolvedora (uma vez)**
1. Abra **developers.facebook.com** e clique em **Começar** (ou "Get Started").
2. Entre com o seu Facebook, aceite os termos e confirme o e-mail e o telefone quando pedir.

**2. Criar o app**
1. Em **Meus apps**, clique em **Criar app**.
2. Caso de uso: escolha **Outro** › Avançar.
3. Tipo de app: escolha **Empresa** › Avançar.
4. Portfólio empresarial: escolha **Não quero conectar agora** (dá para fazer depois).
5. Nome do app (ex.: `gestao-contas`) e o seu e-mail › **Criar app**. Pode pedir a senha do Facebook.

**3. Ligar o Instagram e o login do Facebook**
1. No painel do app, procure a lista de produtos e, no card **Instagram**, clique em **Configurar**.
2. Abre a página **Configuração da API com login do Facebook**. Clique em **Configurar o Login do Facebook para Empresas**.
3. Se aparecer o campo **URIs de redirecionamento do OAuth válidos**, coloque `http://localhost:3000/api/facebook/callback`
   e salve. Se ele recusar por não ser `https`, deixe em branco: em modo Desenvolvimento a Meta aceita `localhost`.
4. Não clique em "Publicar" nem mude para "Ao vivo": o app fica em **Desenvolvimento**.

**4. Copiar o ID e a chave**
1. Menu da esquerda: **Configurações do app** › **Básico**.
2. Copie o **ID do Aplicativo**.
3. Ao lado de **Chave Secreta do Aplicativo**, clique em **Mostrar** (pede a senha do Facebook) e copie **a chave inteira**
   (são 32 letras e números).
4. Guarde os dois para a Parte 5. **A chave secreta é como uma senha:** não envie por mensagem nem publique.

> Se, ao entrar com o Facebook no dashboard (Parte 6), a Meta mostrar um erro de permissões ("Invalid Scopes" ou
> "configuração necessária"), crie uma configuração: **Login do Facebook para Empresas** › **Configurações** ›
> **Criar configuração** › tipo **Token de acesso do usuário** › marque as permissões `instagram_basic`,
> `instagram_content_publish`, `instagram_manage_insights`, `instagram_manage_comments`, `pages_show_list`,
> `pages_read_engagement` e `business_management` › salve e copie o **ID da configuração** para `FB_CONFIG_ID` no `.env`.

## Parte 5. Configurar

**Jeito rápido:** na pasta `dashboard`, dê dois cliques em **`configurar.cmd`**. Um menu pergunta cada valor (ID e chave
do app da Meta, chave do Jev, assistente ChatGPT ou Claude, bancos de imagem), grava no `backend\.env`, **testa cada
chave na hora** (avisa, por exemplo, se a chave secreta foi copiada pela metade), faz o login do assistente e confere
se os programas da Parte 1 estão instalados. Se usar o menu, pule para a Parte 6.

**Jeito manual:**

1. Na pasta `dashboard`, dê **dois cliques em `iniciar.cmd`**. Na primeira vez ele cria o arquivo de configuração
   `backend\.env` e avisa. Feche a janela.
2. Abra a pasta `Documentos\gestaodeinstagram\dashboard\backend`, clique com o botão direito em `.env` ›
   **Abrir com** › **Bloco de Notas**.
3. Preencha:

```
FB_APP_ID=o ID do app (Parte 4.4)
FB_APP_SECRET=a chave secreta do app (Parte 4.4)
AI_PROVIDER=chatgpt
```

4. O **Jev** (dá nota às legendas, guia as reescritas e escolhe as melhores fotos) usa a chave que quem montou o
   dashboard vai te passar. Cole na linha:

```
TYPESAFE_API_KEY=a chave do Jev
```

5. Opcionais, para sugestões de fotos e vídeos gratuitos (crie as suas, grátis, ou peça a quem montou o dashboard):

```
UNSPLASH_ACCESS_KEY=   (fotos gratuitas de alta qualidade)
PIXABAY_API_KEY=   (fotos e vídeos gratuitos)
```

6. Salve (**Ctrl+S**). Não precisa mexer em `PUBLIC_BASE_URL`: o `iniciar.cmd` preenche sozinho.

> O `.env` guarda chaves secretas: não envie esse arquivo para ninguém e não publique.

## Parte 6. Abrir e adicionar as contas

1. Dê dois cliques em **`iniciar.cmd`**. Uma janela preta abre (**deixe aberta** enquanto usa o dashboard) e, em uns
   30 segundos, o navegador abre em **http://localhost:4300**.
   - Dica: clique com o botão direito em `iniciar.cmd` › **Enviar para** › **Área de trabalho (criar atalho)**.
2. Na primeira vez, crie a **senha do dashboard** (marque "manter conectado" se o notebook for só seu).
3. No menu de cima, clique em **Contas** › **Entrar com o Facebook**.
4. Na janela do Facebook:
   - clique em **Editar acesso** (ou "Editar configurações");
   - marque **todas as Páginas** e **todas as contas do Instagram** que quer gerenciar;
   - **aceite todas as permissões**.
5. De volta ao dashboard, as contas encontradas aparecem na lista. Para cada uma, escolha o **tipo de negócio** e clique
   em **Adicionar**. Ela já entra conectada e começa a sincronizar.
6. Em **Suas contas no dashboard**, clique em **Perfil da conta** e preencha com calma: público, tom de voz,
   produtos e preços, links, o que nunca dizer. É o que o assistente lê para escrever do seu jeito.

Se uma conta não aparecer: confira a Parte 4.3, entre de novo e use "Editar acesso" para marcá-la.

## Parte 7. Dia a dia

- **Abrir:** dois cliques no atalho do `iniciar.cmd`. **Fechar:** feche a janela preta.
- **Publicar e agendar** só funcionam com a janela preta aberta. Posts agendados saem no horário se o notebook
  estiver ligado com o dashboard aberto; se não estiver, ficam como "Falhou" e você publica com um clique depois
  (aba **Agendados**).
- **A cada ~60 dias** a Meta pede para entrar de novo: **Contas** › **Entrar de novo**.
- **Atualizar o dashboard** quando houver novidade: feche a janela preta e, no PowerShell,

```powershell
cd $HOME\Documents\gestaodeinstagram
git pull
cd dashboard
npm install
```

- Todas as funções estão explicadas em **Ajuda** (menu de cima) e nas dicas ao passar o mouse.

## Parte 8. Editar vídeos e imagens no Estúdio (sem VS Code)

O dashboard tem a página **Estúdio** (menu de cima). Ela usa o **FFmpeg** (instalado na Parte 1) para editar e o seu
assistente (ChatGPT ou Claude) para entender o pedido. O **Kdenlive** fica para o acabamento visual (linha do tempo,
transições, ajuste fino das legendas); o próprio Estúdio tem um guia do que cada recurso do Kdenlive faz.

### Como usar

1. Crie uma pasta para cada vídeo (ex.: `Documentos\Videos\lancamento`) e coloque nela os arquivos brutos.
2. No Explorador de Arquivos, clique com o botão direito na pasta › **Copiar como caminho**.
3. No dashboard: **Estúdio** › cole o caminho (um por linha, pode ser mais de uma pasta) › **Carregar arquivos** ›
   marque os arquivos que vão entrar.
4. Escreva o que quer, ou clique numa receita (Reels vertical, Cortar trecho, Juntar vídeos, Legendas, Música de fundo,
   Comprimir, Capa, Fotos para carrossel…). Exemplos:
   - "Corte de 00:05 até 00:40 e deixe vertical 1080x1920 com fundo desfocado."
   - "Junte os 3 vídeos nessa ordem, com a música baixinha no fundo."
   - "Coloque estas legendas no vídeo: …" (cole o texto)
5. **Planejar edição**: o assistente monta o plano. Confira os passos (dá para ver o comando exato) e clique em
   **Executar**. Nada roda antes disso.
6. Os arquivos prontos ficam na pasta **`editados`**, dentro da pasta dos originais (botão **Abrir pasta editados**).
   Os originais nunca são alterados e nada é sobrescrito.
7. Suba o resultado em **Publicar › Reels** (ou carrossel, Story).

### Legendas

- **Do seu texto:** receita "Legendas do meu texto".
- **Do que é falado (automática):** aparece no Estúdio quando o FFmpeg instalado tem o reconhecimento de fala; na
  primeira vez, clique em **baixar** para trazer o modelo de português (466 MB, uma vez só).
- **Se a automática não aparecer:** no Kdenlive, use a **Legendagem automática** (veja "Legendas" no guia do Estúdio),
  exporte o `.srt` para a mesma pasta do vídeo e peça no Estúdio: "queime a legenda legendas.srt no vídeo".

### Acabamento no Kdenlive

Abra o arquivo da pasta `editados` no Kdenlive, edite e exporte em **Projeto › Renderizar**: MP4 (H.264), 1080x1920,
30 qps. O guia na página do Estúdio explica cada recurso (legendas, cortes, títulos, efeitos, áudio, exportar).

## Problemas comuns

| O que aparece | O que fazer |
|---|---|
| `winget` não é reconhecido | Atualize o "Instalador de Aplicativo" na Microsoft Store e abra o PowerShell de novo |
| `node -v` mostra v26 | Rode `winget uninstall OpenJS.NodeJS.LTS` e depois o comando da Parte 1 com `--version 24.22.1` |
| "Configuração pendente" no topo do dashboard | Faltam `FB_APP_ID`/`FB_APP_SECRET` no `backend\.env` (Parte 5); salve e abra de novo |
| "Codex não está logado" ou "Claude Code não está logado" | Rode `codex` (ou `claude`) no PowerShell e entre de novo |
| Nenhuma conta aparece em Contas | Parte 4.3 (vínculo com a Página) e "Editar acesso" na janela do Facebook |
| "Publicar está desligado" | A janela preta precisa estar aberta; se o túnel falhou, feche e abra o `iniciar.cmd` de novo |
| Estúdio: "O FFmpeg não está instalado" | Rode `winget install -e --id Gyan.FFmpeg`, feche e abra o `iniciar.cmd` de novo |
| Estúdio: "Este plano não pode ser executado" | Peça de novo com mais detalhes (nomes dos arquivos, tempos); o plano só pode usar os arquivos marcados |
| "Porta em uso" ao abrir | Já existe um dashboard aberto: feche as janelas pretas e abra de novo |
| Erro do Facebook sobre o app ("app não disponível", "URL bloqueada") | Confira o ID e a chave no `.env` (Parte 4.4, passo 4) e se o app está em Desenvolvimento; entre com o mesmo Facebook que criou o app |
| Erro de permissões ("Invalid Scopes") ao entrar com o Facebook | Crie a configuração do aviso da Parte 4.4 e coloque o ID em `FB_CONFIG_ID` |
