import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, OnInit, PLATFORM_ID, signal } from '@angular/core';
import { PageNavigation } from '../page-navigation/page-navigation';
import { Candidate, CandidateRating, SupabaseService } from '../supabase.service';

@Component({
  selector: 'app-premiere-impression',
  imports: [PageNavigation],
  templateUrl: './premiere-impression.html',
  styleUrl: './premiere-impression.css',
})
export class PremiereImpression implements OnInit {
  private readonly supabase = inject(SupabaseService);
  private readonly platformId = inject(PLATFORM_ID);
  readonly candidates = signal<Candidate[]>([]);
  readonly loading = signal(true);
  readonly errorMessage = signal('');
  readonly ratingError = signal('');
  readonly ratings = signal<Record<number, number>>({});
  readonly savingCandidateIds = signal<Set<number>>(new Set());
  readonly regionSearch = signal('');
  readonly filteredCandidates = computed(() => {
    const search = this.regionSearch().trim().toLocaleLowerCase('fr');
    if (!search) return this.candidates();

    return this.candidates().filter((candidate) =>
      candidate.region.toLocaleLowerCase('fr').includes(search),
    );
  });

  updateRegionSearch(value: string) {
    this.regionSearch.set(value);
  }

  getRating(candidateId: number): number {
    return this.ratings()[candidateId] ?? 0;
  }

  async rateCandidate(candidateId: number, etoiles: number) {
    const joueur = this.supabase.joueur();
    if (!joueur || etoiles < 1 || etoiles > 5) {
      this.ratingError.set('Rejoins un salon pour pouvoir noter les candidates.');
      return;
    }

    this.ratingError.set('');
    this.savingCandidateIds.update((ids) => new Set(ids).add(candidateId));
    try {
      await this.supabase.saveCandidateRating(joueur.id, candidateId, etoiles);
      this.ratings.update((ratings) => ({ ...ratings, [candidateId]: etoiles }));
    } catch (error) {
      console.error('Impossible d’enregistrer la note.', error);
      this.ratingError.set('La note n’a pas pu être enregistrée. Réessaie.');
    } finally {
      this.savingCandidateIds.update((ids) => {
        const updatedIds = new Set(ids);
        updatedIds.delete(candidateId);
        return updatedIds;
      });
    }
  }

  private ratingsByCandidate(ratings: CandidateRating[]): Record<number, number> {
    return Object.fromEntries(
      ratings.map(({ candidate_id, etoiles }) => [candidate_id, etoiles]),
    );
  }

  async ngOnInit() {
    if (!isPlatformBrowser(this.platformId)) {
      this.loading.set(false);
      return;
    }

    try {
      const candidates = await this.supabase.getCandidates();
      this.candidates.set(candidates);
      const joueur = this.supabase.joueur();
      if (joueur) {
        const ratings = await this.supabase.getCandidateRatings(joueur.id);
        this.ratings.set(this.ratingsByCandidate(ratings));
      }
    } catch (error) {
      console.error('Impossible de charger les candidates.', error);
      this.errorMessage.set('Impossible de charger les candidates. Réessaie plus tard.');
    } finally {
      this.loading.set(false);
    }
  }

  getPhotoUrl(candidate: Candidate): string {
    const photoUrl = candidate.photo_url?.trim();
    if (photoUrl) {
      if (/^(https?:)?\/\//i.test(photoUrl) || photoUrl.startsWith('/')) {
        return photoUrl;
      }
      return `/img/${photoUrl.replace(/^img[\\/]/i, '')}`;
    }

    const regionSlug = candidate.region
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/^miss\s+/, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    return `/img/460x0_miss-${regionSlug}-2026.webp`;
  }
}
