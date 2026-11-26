import { Routes } from '@angular/router';
import { Home } from './home/home';
import { PremiereImpression } from './impression/premiere-impression';

export const routes: Routes = [
  { path: '', component: Home },
  { path: 'premiere-impression', component: PremiereImpression },
];
