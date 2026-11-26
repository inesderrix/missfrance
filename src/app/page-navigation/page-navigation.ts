import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SupabaseService } from '../supabase.service';

@Component({
  selector: 'app-page-navigation',
  imports: [RouterLink],
  templateUrl: './page-navigation.html',
  styleUrl: './page-navigation.css',
})
export class PageNavigation {
  private readonly supabase = inject(SupabaseService);
  readonly isAdmin = computed(() => {
    const salon = this.supabase.salon();
    const joueur = this.supabase.joueur();
    return !!salon && !!joueur && salon.admin_id === joueur.user_id;
  });
}
