import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { OnDestroy, OnInit, PLATFORM_ID } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { getSalonStageRoute, SupabaseService } from '../supabase.service';

@Component({
  selector: 'app-page-navigation',
  imports: [RouterLink],
  templateUrl: './page-navigation.html',
  styleUrl: './page-navigation.css',
})
export class PageNavigation implements OnInit, OnDestroy {
  private readonly supabase = inject(SupabaseService);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);
  private refreshTimer?: ReturnType<typeof setInterval>;
  private refreshing = false;
  readonly returnRoute = this.router.url.split(/[?#]/, 1)[0];
  readonly isAdmin = computed(() => {
    const salon = this.supabase.salon();
    const joueur = this.supabase.joueur();
    return !!salon && !!joueur && salon.admin_id === joueur.user_id;
  });

  ngOnInit() {
    if (!isPlatformBrowser(this.platformId)) return;
    void this.refreshCurrentStage();
    this.refreshTimer = setInterval(() => void this.refreshCurrentStage(), 5000);
  }

  ngOnDestroy() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  private async refreshCurrentStage() {
    if (this.refreshing) return;
    const salon = this.supabase.salon();
    if (!salon) return;

    this.refreshing = true;
    try {
      const currentSalon = await this.supabase.refreshSalon(salon.id);
      const route = getSalonStageRoute(currentSalon.etape);
      if (this.router.url.split(/[?#]/, 1)[0] !== route) {
        await this.router.navigateByUrl(route);
      }
    } catch (error) {
      console.error('Impossible de synchroniser l’étape du salon.', error);
    } finally {
      this.refreshing = false;
    }
  }
}
