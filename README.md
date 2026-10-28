# Dashboard de gestão de contas do Instagram

Painel para publicar e acompanhar várias contas profissionais do Instagram usando só a API oficial da Meta:

- Publicação de posts, carrosséis (até 20 itens) e Reels, inclusive Trial Reels
- Relatórios estratégicos e operacionais, score de engajamento ponderado, comparação entre contas, alertas e CSV
- Experimentos (formato, gancho, estilo) e ciclos de 10 dias
- Rascunhos com assistente Claude (legendas, roteiros, ganchos, hashtags)
- Planejamento de tráfego pago
- Descoberta de perfis (busca por hashtag, Business Discovery, sugestões por afinidade)
- Página de Ajuda completa

Stack: Angular 22 (frontend) e Node 24 + Express 5 + SQLite (backend), em TypeScript.

## Começar

- Rodar no seu computador: [dashboard/SETUP.md](dashboard/SETUP.md)
- Instalar num servidor com domínio: [dashboard/DEPLOY.md](dashboard/DEPLOY.md)

```bash
cd dashboard
npm install
npm run dev        # backend :3000 + Angular :4300
```

Testes: `npm test` em `dashboard/backend`; `npx ng test`, `npx ng lint` e `npx ng build` em `dashboard/frontend`.

## Dados e segredos

Contas (`backend/accounts.json`), `.env`, tokens e métricas (`backend/data/`) ficam só na máquina onde o
dashboard roda e estão no `.gitignore`. Tokens são guardados criptografados (AES-256-GCM).

Este projeto não tem vínculo com a Meta nem com o Instagram.
