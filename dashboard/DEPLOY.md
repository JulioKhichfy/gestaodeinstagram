# Instalar o dashboard num servidor (VPS)

Este guia põe a versão atual no ar, num servidor próprio com domínio e HTTPS. A versão atual atende **um
dono com várias contas**; vender para vários clientes exige a etapa multiusuário (veja o fim deste arquivo).

Com o servidor, o túnel (ngrok) deixa de ser necessário: o próprio domínio é o endereço público que o
Instagram usa para o login e para baixar as fotos e vídeos.

Arquitetura no servidor:

```
Internet ──HTTPS──> Caddy (porta 443, certificado automático)
                      ├── /api/*  e /media/*  ──> backend Node (127.0.0.1:3000, systemd)
                      └── o resto             ──> Angular compilado (arquivos estáticos)
```

Nos exemplos: domínio `painel.seudominio.com.br`, usuário Linux `gestao` e código em `/opt/gestao`.
Troque pelos seus.

---

## 1. Contratar

- **Servidor:** VPS com Ubuntu 24.04 LTS, pelo menos 1 vCPU, 2 GB de RAM (4 GB é mais folgado para
  compilar o Angular) e 40 GB de disco. Escolha o datacenter no Brasil, se houver.
- **Domínio:** `.com.br` no [registro.br](https://registro.br) (exige CPF ou CNPJ).
  Evite "instagram", "insta" ou "gram" no nome: são marcas da Meta, e ela costuma recusar esses nomes.

## 2. DNS

No painel do registro.br (ou onde estiver o DNS), crie um registro:

| Tipo | Nome | Valor |
|---|---|---|
| A | `painel` | IP do servidor |

Espere propagar (minutos a algumas horas). Teste no seu PC: `nslookup painel.seudominio.com.br`.

## 3. Primeiro acesso e segurança básica

No seu PC (PowerShell), crie uma chave SSH se ainda não tiver: `ssh-keygen -t ed25519`.
Cadastre a chave pública (`~/.ssh/id_ed25519.pub`) no painel da VPS, ou entre com a senha root uma vez:

```bash
ssh root@IP_DO_SERVIDOR

# Atualizações e ferramentas
apt update && apt upgrade -y
apt install -y git sqlite3 ufw unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades    # atualizações de segurança automáticas

# Usuário sem privilégios para rodar o dashboard
adduser --disabled-password --gecos "" gestao
mkdir -p /opt/gestao && chown gestao:gestao /opt/gestao

# Firewall: só SSH e web
ufw allow OpenSSH
ufw allow 80,443/tcp
ufw enable
```

Recomendado: depois de confirmar que entra com a chave, desligue o login por senha
(`PasswordAuthentication no` em `/etc/ssh/sshd_config` e `systemctl restart ssh`).

## 4. Node.js 24 e Caddy

```bash
# Node 24 (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt install -y nodejs
node -v    # v24.x

# Caddy (servidor web com HTTPS automático)
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy
```

## 5. Código e build

```bash
su - gestao
cd /opt/gestao
git clone https://github.com/JulioKhichfy/gestaodeinstagram.git .
cd dashboard
npm install                      # instala backend e frontend
cd frontend && npx ng build && cd ..
```

O build fica em `dashboard/frontend/dist/frontend/browser`.

## 6. Configuração (o que não vai para o Git)

Ainda como `gestao`:

```bash
cd /opt/gestao/dashboard/backend
cp .env.example .env
nano .env
```

```
IG_APP_ID=...
IG_APP_SECRET=...
PUBLIC_BASE_URL=https://painel.seudominio.com.br
FRONTEND_URL=https://painel.seudominio.com.br
PORT=3000
# Descoberta (opcional)
FB_APP_ID=...
FB_APP_SECRET=...
FB_REDIRECT_BASE=https://painel.seudominio.com.br
```

```bash
chmod 600 .env
cp accounts.example.json accounts.json && nano accounts.json    # as contas (SETUP.md, passo 1.1)
```

As pastas com o `claude.md` de cada conta também ficam fora do Git. Copie do seu PC (PowerShell):

```powershell
scp -r .\Pasta-da-conta gestao@IP_DO_SERVIDOR:/opt/gestao/
```

**Levar os dados do PC (opcional):** copie a pasta `dashboard/backend/data/` inteira (`store.json`,
`secret.key` e `dashboard.db`) para o mesmo lugar no servidor, **com o backend parado nos dois lados**.
Assim a senha do dashboard, as conexões e o histórico de métricas continuam valendo. O `secret.key` e o
`store.json` precisam ir juntos: um sem o outro não abre os tokens.

## 7. Backend como serviço (systemd)

Volte para root (`exit`) e crie `/etc/systemd/system/gestao.service`:

```ini
[Unit]
Description=Dashboard de gestão de contas (backend)
After=network-online.target
Wants=network-online.target

[Service]
User=gestao
WorkingDirectory=/opt/gestao/dashboard/backend
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now gestao
systemctl status gestao          # deve estar "active (running)"
journalctl -u gestao -f          # logs ao vivo (Ctrl+C para sair)
```

## 8. Caddy (HTTPS e site)

Substitua o conteúdo de `/etc/caddy/Caddyfile`:

```
painel.seudominio.com.br {
	encode zstd gzip

	handle /api/* {
		reverse_proxy 127.0.0.1:3000
	}
	handle /media/* {
		reverse_proxy 127.0.0.1:3000
	}
	handle {
		root * /opt/gestao/dashboard/frontend/dist/frontend/browser
		try_files {path} /index.html
		file_server
	}

	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options nosniff
		Referrer-Policy strict-origin-when-cross-origin
	}
}
```

```bash
systemctl reload caddy
```

O Caddy emite o certificado HTTPS sozinho na primeira visita (o DNS do passo 2 precisa estar
propagado). Teste: `https://painel.seudominio.com.br/api/health` deve mostrar `{"ok":true}`.

## 9. Ajustes no app da Meta

Troque o endereço do túnel pelo domínio:

- **Instagram › Configurar o login comercial do Instagram › URI de redirecionamento:**
  `https://painel.seudominio.com.br/api/instagram/callback`
- **Login do Facebook para Empresas › URIs de redirecionamento do OAuth válidos** (se usar a Descoberta):
  `https://painel.seudominio.com.br/api/facebook/callback`
- **Configurações › Básico › Domínios do app:** `painel.seudominio.com.br`

Abra `https://painel.seudominio.com.br`, entre com a senha do dashboard (ou crie, se não trouxe os dados)
e reconecte as contas se o painel pedir.

## 10. Assistente Claude no servidor

O botão "Pedir ao Claude" usa o Claude Code instalado na máquina. No servidor:

```bash
npm install -g @anthropic-ai/claude-code
su - gestao
claude setup-token        # gera um token de longa duração da sua assinatura (siga o link)
```

Coloque o token gerado no `.env` como `CLAUDE_CODE_OAUTH_TOKEN=...` e reinicie (`systemctl restart gestao`).

**Atenção:** a assinatura do Claude é de uso pessoal. Para atender **clientes pagantes**, o assistente
precisa usar a API da Anthropic (chave de API, cobrança por uso). Essa troca faz parte da etapa multiusuário.

## 11. Backup diário

Como `gestao`, crie `/opt/gestao/backup.sh`:

```bash
#!/bin/sh
set -e
D=/opt/gestao/backups/$(date +%F)
mkdir -p "$D"
cd /opt/gestao/dashboard/backend
sqlite3 data/dashboard.db ".backup '$D/dashboard.db'"   # cópia consistente com o banco em uso
cp data/store.json data/secret.key accounts.json .env "$D/"
find /opt/gestao/backups -maxdepth 1 -type d -mtime +14 -exec rm -rf {} +   # guarda 14 dias
```

```bash
chmod 700 /opt/gestao/backup.sh
crontab -e     # adicione a linha:
# 30 3 * * * /opt/gestao/backup.sh
```

Esse backup fica no próprio servidor. Ative também o backup/snapshot do provedor, ou copie a pasta
`backups` para fora (por exemplo, `scp` periódico para o seu PC). **Os backups contêm tokens e o
`secret.key`: guarde-os com o mesmo cuidado de uma senha.**

## 12. Atualizar o dashboard

```bash
su - gestao
cd /opt/gestao && git pull
cd dashboard && npm install
cd frontend && npx ng build && cd ..
exit
systemctl restart gestao
```

## Problemas comuns

| Sintoma | O que verificar |
|---|---|
| Site não abre / erro de certificado | DNS propagado? `journalctl -u caddy -n 50`. Portas 80 e 443 liberadas no `ufw` e no firewall do provedor |
| `/api/health` dá 502 | Backend parado: `systemctl status gestao` e `journalctl -u gestao -n 100` |
| "Invalid redirect_uri" | URI na Meta diferente de `PUBLIC_BASE_URL/api/instagram/callback` |
| Faixa "Configuração pendente" | `.env` incompleto ou backend não reiniciado depois de editar |
| Instagram não baixa a mídia ao publicar | Teste `https://painel.seudominio.com.br/media/` (404 é normal). Veja os logs do backend |

---

## Antes de vender para outros clientes

A instalação acima atende um dono. Para assinatura com vários clientes faltam:

1. **Multiusuário no código:** cadastro e login por cliente, cada um com as próprias contas, dados
   isolados e limites por plano.
2. **App da Meta em modo Ativo:** fora do modo Desenvolvimento, só funciona depois da **Análise do app**
   (App Review) de cada permissão e da **verificação do negócio** (CNPJ ajuda). A Meta também exige
   política de privacidade, termos de uso e um endereço para exclusão de dados.
3. **Claude via API** no lugar da assinatura pessoal, com controle de custo por cliente.
4. **Cobrança recorrente** (ex.: Mercado Pago ou Stripe), LGPD e suporte.
