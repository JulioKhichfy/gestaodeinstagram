# Configuração do Dashboard (uma vez só)

O dashboard roda no seu PC. Duas peças externas são obrigatórias:

- **App da Meta**: é por ele que o Instagram autoriza o dashboard a publicar.
- **Túnel HTTPS (ngrok)**: o Instagram precisa *baixar* a foto/vídeo do seu PC e
  devolver o login para um endereço `https://`. O túnel cria esse endereço público
  apontando para o backend (porta 3000).

> Os menus da Meta mudam de nome com frequência. Se algo abaixo não bater exatamente,
> procure pelo termo entre aspas.

---

## 1. Instalar dependências

```powershell
cd caminho\do\projeto\dashboard
npm install
```

### 1.1 Cadastrar as contas

Copie `backend/accounts.example.json` para `backend/accounts.json` e coloque as suas contas:

```json
[
  { "id": "minha-loja", "label": "Minha loja", "username": "minha.loja", "folder": "contas/minha-loja", "business": "loja" }
]
```

- `id`: nome curto da aba (letras minúsculas, números e hífen). Não mude depois: as métricas ficam ligadas a ele.
- `username`: o @ da conta, sem o @. O login do Instagram recusa outra conta.
- `folder`: pasta (relativa à raiz do projeto) com o `claude.md` da conta, que o assistente Claude lê.
  Use `dashboard/exemplo-conta/claude.md` como modelo.
- `business`: `livros`, `servicos` ou `loja` (orienta o tráfego pago e o Claude).
- `ads` (opcional): `objective`, `audience`, `budget`, `tip` para sobrepor a recomendação de tráfego pago.

O `accounts.json` e as pastas das contas são dados do cliente: ficam **fora do Git**.

## 2. Túnel ngrok (endereço fixo gratuito)

1. Crie uma conta grátis em https://ngrok.com
2. Instale: `winget install ngrok.ngrok`
3. Conecte sua conta: `ngrok config add-authtoken <SEU_TOKEN>` (o token está no painel do ngrok; nunca o coloque em arquivos do projeto)
4. No painel do ngrok, em **Domains**, pegue seu domínio estático gratuito
   (ex.: `seu-nome.ngrok-free.app`).
5. Teste: `ngrok http 3000 --domain=seu-nome.ngrok-free.app` (só o domínio, sem `https://`)
   - `--domain` funciona em qualquer ngrok v3. Versões novas também aceitam `--url=https://...`;
     se aparecer "unknown flag: --url", é porque o ngrok é antigo (atualize com `ngrok update`).

Guarde esse endereço: ele é o `PUBLIC_BASE_URL`.

## 3. App na Meta

1. Acesse https://developers.facebook.com → **Meus apps** → **Criar app**.
2. Caso de uso: **"Gerenciar mensagens e conteúdo no Instagram"** (Instagram API).
3. No painel do app, abra **Instagram → "Configuração da API com login do Instagram"**
   (*API setup with Instagram login*).
4. Copie o **ID do app do Instagram** e a **Chave secreta do app do Instagram**.
   Atenção: são os do *Instagram*, não os do app do Facebook que aparecem em Configurações básicas.
5. Em **"Configurar o login comercial do Instagram"** (*Set up Instagram business login*),
   adicione o **URI de redirecionamento OAuth**:
   ```
   https://seu-nome.ngrok-free.app/api/instagram/callback
   ```
6. Em **Funções do app → Funções → Testadores do Instagram**, adicione cada conta do `accounts.json` (passo 1.1).
7. Em cada conta, aceite o convite: instagram.com → **Configurações → Apps e sites →
   Convites de testador**.
8. Deixe o app em **modo Desenvolvimento**. Não precisa passar por revisão da Meta,
   porque só as suas contas (testadoras) vão usar.

## 4. Arquivo `.env`

Copie `backend/.env.example` para `backend/.env` e preencha:

```
IG_APP_ID=...                 # passo 3.4
IG_APP_SECRET=...             # passo 3.4
PUBLIC_BASE_URL=https://seu-nome.ngrok-free.app
```

**Nunca** compartilhe o `.env` nem a pasta `backend/data/`, onde ficam os tokens criptografados.

## 5. Primeiro uso

Abra **dois terminais** na pasta `dashboard`:

```powershell
# Terminal 1: túnel
ngrok http 3000 --domain=seu-nome.ngrok-free.app

# Terminal 2: dashboard (backend + Angular)
npm run dev
```

1. Abra http://localhost:4300
2. Crie a **senha do dashboard** e marque "Manter conectado", se quiser.
3. Em cada aba, clique em **Conectar Instagram** e faça login com a conta daquela aba.
   O dashboard recusa se você entrar com a conta errada.

## 6. Versão 2: métricas e Claude

- **Reconecte as contas uma vez.** A v2 pede uma permissão nova (`instagram_business_manage_insights`) para ler
  métricas. A aba da conta mostra um aviso "Reconecte esta conta" até isso ser feito.
- **Claude:** o dashboard usa a sua assinatura por meio do **Claude Code** instalado neste PC (comando `claude`).
  Confirme que ele está logado: abra um terminal, rode `claude` e faça login se pedir. Não precisa de chave de API.
  Opcional no `.env`: `CLAUDE_MODEL` (modelo) e `CLAUDE_BIN` (caminho do executável).
- A primeira sincronização roda logo após conectar e depois a cada 6h (ou no botão "Sincronizar").

## 7. Versão 3: Descoberta de perfis (opcional)

A aba **Descoberta** busca por hashtag e mostra dados públicos de outros perfis. A Meta só oferece isso na
**API do Instagram com login do Facebook**, por isso é uma conexão à parte (uma só para o dashboard todo).

1. **Vincule cada conta do Instagram a uma Página do Facebook** (app do Instagram › Editar perfil › Página,
   ou Central de Contas). Se só uma estiver vinculada, as consultas das outras saem por ela.
2. No **mesmo app** da Meta: **Adicionar produto › Login do Facebook para Empresas**
   (*Facebook Login for Business*). Em modo Desenvolvimento, o retorno
   `http://localhost:3000/api/facebook/callback` é aceito sem cadastro. Se a Meta reclamar, cadastre-o
   em **URIs de redirecionamento do OAuth válidos**.
3. Em **Configurações do app › Básico**, copie o **ID do app** e a **Chave secreta do app**
   (são diferentes dos do Instagram) para o `.env`:
   ```
   FB_APP_ID=...
   FB_APP_SECRET=...
   ```
   **Quem faz o login do Facebook:** o perfil que administra as Páginas precisa ter uma função no app da Meta
   (modo Desenvolvimento). Se o app foi criado no Facebook de outra pessoa, adicione o Facebook da dona das
   Páginas em **Funções do app › Funções** (Administrador ou Desenvolvedor), e ela aceita o convite.
   Alternativa: a dona dá acesso às Páginas para o Facebook de quem criou o app (configurações da Página › Acesso).
4. Reinicie o `npm run dev`, abra a aba **Descoberta** e clique em **Conectar Facebook**. Entre com o
   Facebook que administra as Páginas e marque todas as Páginas e permissões pedidas.
5. **Busca por hashtag** exige o recurso *Instagram Public Content Access*. A Meta costuma liberá-lo só
   após **Análise do app** (App Review) e verificação do negócio. Sem ele, a busca mostra "A Meta recusou",
   mas as Sugestões, a Lista salva e os dados públicos dos perfis continuam funcionando.

O acesso do Facebook dura cerca de 60 dias e não renova sozinho: depois disso, clique em **Reconectar** na Descoberta.

---

## Uso diário

- Ver perfis e posts recentes: só `npm run dev`.
- **Conectar ou publicar: o túnel precisa estar rodando.**
- "Manter conectado" no Instagram: o acesso dura 60 dias e o backend o renova sozinho
  enquanto estiver rodando. Se ficar mais de ~2 meses sem abrir o dashboard, clique em "Reconectar".

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| Faixa amarela "Configuração pendente" | `.env` incompleto, ou o backend não foi reiniciado após editar o `.env` |
| "Invalid redirect_uri" na tela do Instagram | O URI do passo 3.5 não é idêntico a `PUBLIC_BASE_URL/api/instagram/callback` |
| "Insufficient developer role" | A conta não foi adicionada como testadora ou não aceitou o convite (passos 3.6–3.7) |
| "Você entrou como @x, mas esta aba é da @y" | Você logou com a conta errada. Saia do instagram.com no navegador e tente de novo |
| Falha ao publicar dizendo que a mídia não pôde ser baixada | Túnel desligado, `PUBLIC_BASE_URL` errado, ou a página de aviso do ngrok gratuito bloqueando o acesso. Teste abrindo `PUBLIC_BASE_URL/api/health` (deve mostrar `{"ok":true}`) |
| Erro de proporção da imagem | O feed aceita de 4:5 (retrato) até 1.91:1 (paisagem) |
| Descoberta: "Nenhuma das contas apareceu vinculada a uma Página" | Vincule as contas a Páginas (passo 7.1) e, ao conectar o Facebook, marque essas Páginas |
| Descoberta: "A Meta recusou a busca por hashtag" | Falta o recurso *Instagram Public Content Access* (App Review). O resto da Descoberta funciona |
| Descoberta: perfil "indisponível" | Conta pessoal, privada, com restrição de idade ou @ trocado: a Meta só mostra contas profissionais |

Dica: se o ngrok der problema, o **Cloudflare Tunnel** (`cloudflared`) é uma alternativa gratuita.
Basta trocar o `PUBLIC_BASE_URL` e o URI de redirecionamento na Meta.
