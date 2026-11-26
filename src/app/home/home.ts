import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SupabaseService } from '../supabase.service';

@Component({
  selector: 'app-home',
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class Home {
  private readonly supabase = inject(SupabaseService);
  private readonly router = inject(Router);
  pseudo = '';
  code = '';
  readonly loading = signal(false);
  readonly errorMessage = signal('');

  updateCode(code: string) {
    this.code = code.toUpperCase();
  }

  async createSalon() {
    await this.enterSalon(() => this.supabase.createSalon(this.pseudo.trim()));
  }

  async joinSalon() {
    if (!this.code.trim()) {
      this.errorMessage.set('Entre le code du salon pour le rejoindre.');
      return;
    }

    await this.enterSalon(() =>
      this.supabase.joinSalon(this.code.trim(), this.pseudo.trim()),
    );
  }

  private async enterSalon(action: () => Promise<unknown>) {
    this.errorMessage.set('');
    if (!this.pseudo.trim()) {
      this.errorMessage.set('Entre ton pseudo pour continuer.');
      return;
    }

    this.loading.set(true);
    try {
      await action();
      await this.router.navigateByUrl('/premiere-impression');
    } catch (error) {
      console.error('Impossible de rejoindre le salon.', error);
      this.errorMessage.set(
        error instanceof Error
          ? error.message
          : 'Une erreur est survenue. Réessaie dans un instant.',
      );
    } finally {
      this.loading.set(false);
    }
  }
}
