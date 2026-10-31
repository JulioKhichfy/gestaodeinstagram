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
| Visual Studio Code | Editar a configuração e, se quiser, editar vídeos com a IA | Grátis |
| cloudflared | Túnel: a Meta baixa daqui as fotos e vídeos na hora de publicar | Grátis |
| Codex (ChatGPT) **ou** Claude Code | O assistente que escreve legendas, roteiros e respostas | Sua assinatura do ChatGPT ou do Claude |
| Instagram profissional + Página do Facebook | Exigência da Meta para gerenciar a conta por um sistema | Grátis |
| Acesso ao app da Meta | Permissão para o dashboard conversar com o Instagram | Grátis |

---

## Parte 1. Instalar os programas

1. Clique no menu Iniciar, digite **PowerShell** e abra o **Windows PowerShell** (não precisa ser como administrador).
2. Copie e cole **uma linha por vez**, apertando Enter depois de cada uma. Se aparecer uma pergunta sobre termos, digite
   `Y` e Enter.

```powershell
winget install -e --id Git.Git
winget install -e --id OpenJS.NodeJS.LTS --version 24.22.1
winget install -e --id Microsoft.VisualStudioCode
winget install -e --id Cloudflare.cloudflared
```

3. **Feche o PowerShell e abra de novo** (para ele enxergar os programas novos) e confira:

```powershell
git --version
node -v
cloudflared --version
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

### 4.4 Acesso ao app da Meta

O dashboard conversa com o Instagram por meio de um "app" cadastrado na Meta. Em modo de testes (o nosso caso), só
pessoas com papel no app conseguem entrar. Existem dois caminhos:

**Caminho A (recomendado): entrar como administradora do app que já existe.**
1. Crie a sua conta de desenvolvedora: abra **developers.facebook.com**, clique em **Começar** e entre com o seu
   Facebook. Confirme o e-mail e o telefone se pedir.
2. Peça a quem administra o app para adicionar você: no painel do app, **Funções do app** › **Funções** ›
   **Adicionar pessoas** › **Administrador** › o seu nome.
3. Aceite o convite em **developers.facebook.com** (aparece um aviso no topo, ou em "Solicitações").
4. Peça a essa pessoa o **ID do app** e a **Chave secreta do app**; você vai usar na Parte 5.

**Caminho B: criar o seu próprio app.** Siga as seções 3 e 1.2 do [SETUP.md](SETUP.md) (criar o app do tipo Empresa
e adicionar o "Login do Facebook para Empresas").

## Parte 5. Configurar

1. Na pasta `dashboard`, dê **dois cliques em `iniciar.cmd`**. Na primeira vez ele cria o arquivo de configuração
   `backend\.env` e avisa. Feche a janela.
2. Abra o VS Code › **Arquivo** › **Abrir pasta** › escolha `Documentos\gestaodeinstagram\dashboard`.
3. Abra `backend\.env` e preencha:

```
FB_APP_ID=o ID do app (Parte 4.4)
FB_APP_SECRET=a chave secreta do app (Parte 4.4)
AI_PROVIDER=chatgpt
```

4. Opcionais, que melhoram os textos e as imagens (peça as chaves a quem montou o dashboard, ou crie as suas):

```
TYPESAFE_API_KEY=   (Jev: dá nota às legendas e escolhe as melhores fotos)
UNSPLASH_ACCESS_KEY=   (fotos gratuitas de alta qualidade)
PIXABAY_API_KEY=   (fotos e vídeos gratuitos)
```

5. Salve (**Ctrl+S**). Não precisa mexer em `PUBLIC_BASE_URL`: o `iniciar.cmd` preenche sozinho.

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

## Parte 8. Editar vídeos e imagens com a IA (Kdenlive + VS Code)

O Codex (ChatGPT) e o Claude Code também funcionam **dentro do VS Code**: você pede em português e a IA executa
comandos de edição de vídeo e imagem (com o FFmpeg) na pasta que você abriu. O **Kdenlive** fica para o acabamento
visual (linha do tempo, transições, trilha, textos).

### Instalar

No PowerShell:

```powershell
winget install -e --id KDE.Kdenlive
winget install -e --id Gyan.FFmpeg
```

No VS Code: ícone de **Extensões** (ou Ctrl+Shift+X) › procure **Codex** (da **OpenAI**) › **Instalar** › entre com o
ChatGPT. Quando migrar para o Claude, instale a extensão **Claude Code** (da **Anthropic**).

### Como usar

1. Crie uma pasta para cada vídeo (ex.: `Documentos\Videos\lancamento`) e coloque nela os arquivos brutos.
2. No VS Code: **Arquivo** › **Abrir pasta** › essa pasta. Abra o painel do **Codex** (ícone na barra lateral).
3. Peça o que quer, por exemplo:
   - "Corte o video.mp4 de 00:05 até 00:40 e deixe vertical 1080x1920 com fundo desfocado. Salve como reels.mp4."
   - "Junte clip1.mp4, clip2.mp4 e clip3.mp4 nessa ordem, com a musica.mp3 baixinha no fundo."
   - "Comprima o reels.mp4 para menos de 50 MB sem perder qualidade visível."
   - "Tire um quadro do segundo 3 do reels.mp4 para usar de capa (JPEG 1080x1920)."
   - "Transforme todas as fotos desta pasta em 1080x1350 (4:5) para carrossel, sem distorcer."
4. A IA mostra o comando antes de executar: confira e **aprove**. Os arquivos novos aparecem na pasta.
5. Para acabamento, abra o resultado no **Kdenlive**, edite e exporte em **Projeto › Renderizar**: MP4 (H.264),
   1080x1920, 30 qps. Depois é só subir em **Publicar › Reels** no dashboard.

Dica: peça sempre "salve com outro nome" para nunca perder o original.

## Problemas comuns

| O que aparece | O que fazer |
|---|---|
| `winget` não é reconhecido | Atualize o "Instalador de Aplicativo" na Microsoft Store e abra o PowerShell de novo |
| `node -v` mostra v26 | Rode `winget uninstall OpenJS.NodeJS.LTS` e depois o comando da Parte 1 com `--version 24.22.1` |
| "Configuração pendente" no topo do dashboard | Faltam `FB_APP_ID`/`FB_APP_SECRET` no `backend\.env` (Parte 5); salve e abra de novo |
| "Codex não está logado" ou "Claude Code não está logado" | Rode `codex` (ou `claude`) no PowerShell e entre de novo |
| Nenhuma conta aparece em Contas | Parte 4.3 (vínculo com a Página) e "Editar acesso" na janela do Facebook |
| "Publicar está desligado" | A janela preta precisa estar aberta; se o túnel falhou, feche e abra o `iniciar.cmd` de novo |
| "Porta em uso" ao abrir | Já existe um dashboard aberto: feche as janelas pretas e abra de novo |
| Botão do Facebook dá erro de "app" ou de permissão | Você ainda não aceitou o papel de administradora no app (Parte 4.4) |
