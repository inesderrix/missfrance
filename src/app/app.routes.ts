import { Routes } from '@angular/router';
import { Home } from './home/home';
import { PremiereImpression } from './impression/premiere-impression';

export const routes: Routes = [
  { path: '', component: Home },
  { path: 'premiere-impression', component: PremiereImpression },
  {
    path: 'top12',
    loadComponent: () => import('./top12/top12').then((module) => module.Top12),
  },
  {
    path: 'top5',
    loadComponent: () => import('./top5/top5').then((module) => module.Top5),
  },
  {
    path: 'classement',
    loadComponent: () => import('./classement/classement').then((module) => module.Classement),
  },
  {
    path: 'scores',
    loadComponent: () => import('./scores/scores').then((module) => module.Scores),
  },
  {
    path: 'admin/top12',
    loadComponent: () =>
      import('./admin-top12/admin-top12').then((module) => module.AdminTop12),
  },
];
