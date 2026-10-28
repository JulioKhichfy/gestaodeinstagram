import { Routes } from '@angular/router';
import { authGuard } from './core/session';
import { Shell } from './layout/shell';
import { LoginPage } from './pages/login/login';

const TITLE = 'Guarda-chuva Instagram';

// Páginas carregadas sob demanda (lazy loading): o primeiro carregamento fica leve.
export const routes: Routes = [
  { path: 'login', component: LoginPage, title: `Entrar · ${TITLE}` },
  {
    path: '',
    component: Shell,
    canActivate: [authGuard],
    children: [
      { path: 'visao-geral', title: `Visão geral · ${TITLE}`, loadComponent: () => import('./pages/overview/overview').then((m) => m.OverviewPage) },
      { path: 'ajuda', title: `Ajuda · ${TITLE}`, loadComponent: () => import('./pages/help/help').then((m) => m.HelpPage) },
      { path: 'configuracoes', title: `Configurações · ${TITLE}`, loadComponent: () => import('./pages/settings/settings').then((m) => m.SettingsPage) },
      {
        path: 'conta/:id',
        title: TITLE,
        loadComponent: () => import('./pages/account/account').then((m) => m.AccountPage),
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'publicar' },
          { path: 'publicar', loadComponent: () => import('./pages/account/publish').then((m) => m.PublishPage) },
          { path: 'rascunhos', loadComponent: () => import('./pages/account/drafts').then((m) => m.DraftsPage) },
          { path: 'relatorios', loadComponent: () => import('./pages/account/reports').then((m) => m.ReportsPage) },
          { path: 'posts', loadComponent: () => import('./pages/account/posts').then((m) => m.PostsPage) },
          { path: 'ciclos', loadComponent: () => import('./pages/account/cycles').then((m) => m.CyclesPage) },
          { path: 'trafego', loadComponent: () => import('./pages/account/ads').then((m) => m.AdsPage) },
          { path: 'descoberta', loadComponent: () => import('./pages/account/discovery').then((m) => m.DiscoveryPage) },
        ],
      },
      { path: '', pathMatch: 'full', redirectTo: 'visao-geral' },
    ],
  },
  { path: '**', redirectTo: '' },
];
