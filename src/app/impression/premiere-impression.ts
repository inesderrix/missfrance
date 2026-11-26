import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SupabaseService } from '../supabase.service';

@Component({
  selector: 'app-premiere-impression',
  imports: [RouterLink],
  template: `
    <main class="page">
      <section class="card">
        <p class="eyebrow">Le salon est prêt</p>
        <h1>Première impression</h1>
        @if (salon && joueur) {
          <p>Bienvenue, <strong>{{ joueur.pseudo }}</strong> !</p>
          <p>Tu joues dans <strong>{{ salon.nom }}</strong>.</p>
          <p class="code-label">Code du salon</p>
          <p class="code">{{ salon.code }}</p>
        } @else {
          <p>Ta session de jeu n’a pas été retrouvée. Rejoins un salon pour continuer.</p>
          <a routerLink="/">Retour à l’accueil</a>
        }
      </section>
    </main>
  `,
  styles: `
    :host {
      display: block;
      min-height: 100vh;
      color: #2c1830;
      background: linear-gradient(135deg, #fff8f5, #f8eef5);
      font-family: Arial, sans-serif;
    }
    .page { display: grid; min-height: 100vh; place-items: center; padding: 24px; }
    .card { box-sizing: border-box; width: min(100%, 520px); padding: 40px; border: 1px solid #f0dce7; border-radius: 24px; background: #fff; box-shadow: 0 20px 60px #5e29421a; }
    .eyebrow { color: #a33b68; font-size: .8rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
    h1 { margin: 0 0 24px; font-size: clamp(2rem, 8vw, 2.75rem); }
    .code-label { margin-bottom: 4px; color: #745f70; }
    .code { margin-top: 0; color: #a33b68; font-size: 2rem; font-weight: 700; letter-spacing: .16em; }
    a { color: #8d2f58; }
    @media (max-width: 480px) { .card { padding: 28px 22px; } }
  `,
})
export class PremiereImpression {
  private readonly supabase = inject(SupabaseService);
  readonly salon = this.supabase.salon();
  readonly joueur = this.supabase.joueur();
}
