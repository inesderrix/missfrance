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
  readonly hasSavedGame = this.supabase.hasSavedGame;

  updateCode(code: string) {
    this.code = code.toUpperCase();
  }

  async createSalon() {
    await this.enterSalon(() => this.supabase.createSalon(this.pseudo.trim()), false);
  }

  async joinSalon() {
    if (!this.code.trim()) {
      this.errorMessage.set('Entre le code du salon pour le rejoindre.');
      return;
    }

    await this.enterSalon(
      () => this.supabase.joinSalon(this.code.trim(), this.pseudo.trim()),
      true,
    );
  }

  async reconnect() {
    this.errorMessage.set('');
    this.loading.set(true);
    try {
      await this.supabase.reconnectToSalon();
      await this.navigateToCurrentStage();
    } catch (error) {
      console.error('Impossible de reprendre la partie.', error);
      this.errorMessage.set(
        error instanceof Error
          ? error.message
          : 'Une erreur est survenue. Réessaie dans un instant.',
      );
    } finally {
      this.loading.set(false);
    }
  }

  private async enterSalon(action: () => Promise<unknown>, continueToCurrentStage: boolean) {
    this.errorMessage.set('');
    if (!this.pseudo.trim()) {
      this.errorMessage.set('Entre ton pseudo pour continuer.');
      return;
    }

    this.loading.set(true);
    try {
      await action();
      if (continueToCurrentStage) {
        await this.navigateToCurrentStage();
      } else {
        await this.router.navigateByUrl('/premiere-impression');
      }
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

  private async navigateToCurrentStage() {
    const salon = this.supabase.salon();
    if (!salon) {
      throw new Error('Aucun salon actif n’est disponible.');
    }

    const currentSalon = await this.supabase.refreshSalon(salon.id);
    const [top12, top5, ranking] = await Promise.all([
      this.supabase.getOfficialTop12(currentSalon.id),
      this.supabase.getOfficialTop5(currentSalon.id),
      this.supabase.getOfficialRanking(currentSalon.id),
    ]);

    const route = ranking.length === 5 || top5.length === 5
      ? '/classement'
      : top12.length === 12
        ? '/top5'
        : '/top12';
    await this.router.navigateByUrl(route);
  }
}
