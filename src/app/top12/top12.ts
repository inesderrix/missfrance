import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, OnDestroy, OnInit, PLATFORM_ID, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PageNavigation } from '../page-navigation/page-navigation';
import { Candidate, CandidateRating, RoomTop12Prediction, Salon, SupabaseService } from '../supabase.service';

interface PlayerPrediction {
  joueurId: string;
  pseudo: string;
  candidateIds: number[];
}

@Component({
  selector: 'app-top12',
  imports: [RouterLink, PageNavigation],
  templateUrl: './top12.html',
  styleUrl: './top12.css',
})
export class Top12 implements OnInit, OnDestroy {
  private readonly supabase = inject(SupabaseService);
  private readonly platformId = inject(PLATFORM_ID);
  private refreshTimer?: ReturnType<typeof setInterval>;
  readonly candidates = signal<Candidate[]>([]);
  readonly ratings = signal<Record<number, number>>({});
  readonly selectedIds = signal<number[]>([]);
  readonly salon = this.supabase.salon;
  readonly officialIds = signal<number[]>([]);
  readonly playerPredictions = signal<PlayerPrediction[]>([]);
  readonly otherPlayerPredictions = computed(() => {
    const currentJoueurId = this.supabase.joueur()?.id;
    return this.playerPredictions().filter((player) => player.joueurId !== currentJoueurId);
  });
  readonly isAdmin = computed(() => {
    const salon = this.salon();
    const joueur = this.supabase.joueur();
    return !!salon && !!joueur && salon.admin_id === joueur.user_id;
  });
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly errorMessage = signal('');
  readonly resultsError = signal('');
  readonly search = signal('');
  readonly top12Locked = computed(
    () =>
      this.salon()?.etape !== 'top12' ||
      this.salon()?.statut !== 'ouvert' ||
      this.officialIds().length === 12,
  );

  readonly sortedCandidates = computed(() => {
    const search = this.search().trim().toLocaleLowerCase('fr');
    return [...this.candidates()]
      .filter((candidate) => !search || candidate.region.toLocaleLowerCase('fr').includes(search))
      .sort((a, b) => {
        const ratingDifference = (this.ratings()[b.id] ?? 0) - (this.ratings()[a.id] ?? 0);
        return ratingDifference || a.region.localeCompare(b.region, 'fr');
      });
  });
  readonly selectedCandidates = computed(() =>
    this.selectedIds()
      .map((id) => this.candidates().find((candidate) => candidate.id === id))
      .filter((candidate): candidate is Candidate => candidate !== undefined),
  );

  async ngOnInit() {
    if (!isPlatformBrowser(this.platformId)) {
      this.loading.set(false);
      return;
    }

    const joueur = this.supabase.joueur();
    if (!joueur) {
      this.errorMessage.set('Rejoins un salon pour préparer ton Top 12.');
      this.loading.set(false);
      return;
    }

    try {
      const currentSalon = this.salon();
      if (!currentSalon) {
        this.errorMessage.set('Rejoins un salon pour préparer ton Top 12.');
        return;
      }

      const salon: Salon = await this.supabase.refreshSalon(currentSalon.id);
      const [candidates, ratings, pronostics, officialResults] = await Promise.all([
        this.supabase.getCandidates(),
        this.supabase.getCandidateRatings(joueur.id),
        this.supabase.getTop12(joueur.id),
        this.supabase.getOfficialTop12(salon.id),
      ]);
      this.candidates.set(candidates);
      this.ratings.set(this.ratingsByCandidate(ratings));
      this.selectedIds.set(pronostics);
      this.officialIds.set(officialResults.map(({ candidate_id }) => candidate_id));
      if (salon.statut !== 'ouvert' || officialResults.length === 12) {
        await this.refreshLockedData(salon.id);
      }
    } catch (error) {
      console.error('Impossible de charger le Top 12.', error);
      this.errorMessage.set('Impossible de charger les candidates et pronostics. Réessaie plus tard.');
    } finally {
      this.loading.set(false);
    }

    this.refreshTimer = setInterval(() => {
      void this.refreshRoomState();
    }, 5000);
  }

  ngOnDestroy() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  updateSearch(value: string) {
    this.search.set(value);
  }

  isSelected(candidateId: number): boolean {
    return this.selectedIds().includes(candidateId);
  }

  async toggleCandidate(candidateId: number) {
    const joueur = this.supabase.joueur();
    if (!joueur || this.saving()) return;
    if (this.top12Locked()) {
      this.errorMessage.set('Les pronostics de ce salon sont verrouillés.');
      return;
    }

    const currentIds = this.selectedIds();
    if (!currentIds.includes(candidateId) && currentIds.length >= 12) {
      this.errorMessage.set('Ton Top 12 est complet. Retire une candidate avant d’en ajouter une autre.');
      return;
    }

    const nextIds = currentIds.includes(candidateId)
      ? currentIds.filter((id) => id !== candidateId)
      : [...currentIds, candidateId];

    this.errorMessage.set('');
    this.saving.set(true);
    try {
      await this.supabase.saveTop12(joueur.id, nextIds);
      this.selectedIds.set(nextIds);
    } catch (error) {
      console.error('Impossible d’enregistrer le Top 12.', error);
      this.errorMessage.set('Ta sélection n’a pas pu être enregistrée. Réessaie.');
    } finally {
      this.saving.set(false);
    }
  }

  getPhotoUrl(candidate: Candidate): string {
    const photoUrl = candidate.photo_url?.trim();
    if (photoUrl) {
      if (/^(https?:)?\/\//i.test(photoUrl) || photoUrl.startsWith('/')) return photoUrl;
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

  private ratingsByCandidate(ratings: CandidateRating[]): Record<number, number> {
    return Object.fromEntries(
      ratings.map(({ candidate_id, etoiles }) => [candidate_id, etoiles]),
    );
  }

  private groupPredictions(predictions: RoomTop12Prediction[]): PlayerPrediction[] {
    const grouped = new Map<string, PlayerPrediction>();
    for (const prediction of predictions) {
      const player = grouped.get(prediction.joueur_id) ?? {
        joueurId: prediction.joueur_id,
        pseudo: prediction.pseudo,
        candidateIds: [],
      };
      player.candidateIds.push(prediction.candidate_id);
      grouped.set(prediction.joueur_id, player);
    }
    return [...grouped.values()];
  }

  getHitCount(candidateIds: number[]): number {
    const officialIds = new Set(this.officialIds());
    return candidateIds.filter((candidateId) => officialIds.has(candidateId)).length;
  }

  getCandidateRegions(candidateIds: number[]): string {
    const candidates = new Map(this.candidates().map((candidate) => [candidate.id, candidate]));
    return candidateIds
      .map((candidateId) => candidates.get(candidateId))
      .filter((candidate): candidate is Candidate => candidate !== undefined)
      .map((candidate) => candidate.region)
      .join(', ');
  }

  private async refreshRoomState() {
    const currentSalon = this.salon();
    if (!currentSalon) return;

    try {
      const salon = await this.supabase.refreshSalon(currentSalon.id);
      const officialResults = await this.supabase.getOfficialTop12(salon.id);
      this.officialIds.set(officialResults.map(({ candidate_id }) => candidate_id));
      if (salon.statut !== 'ouvert' || officialResults.length === 12) {
        await this.refreshLockedData(salon.id);
      }
    } catch (error) {
      console.error('Impossible d’actualiser le salon et ses résultats.', error);
    }
  }

  private async refreshLockedData(salonId: string) {
    try {
      const [officialResults, roomPredictions] = await Promise.all([
        this.supabase.getOfficialTop12(salonId),
        this.supabase.getRoomTop12Predictions(salonId),
      ]);
      this.officialIds.set(officialResults.map(({ candidate_id }) => candidate_id));
      this.playerPredictions.set(this.groupPredictions(roomPredictions));
      this.resultsError.set('');
    } catch (error) {
      console.error('Impossible d’actualiser le résultat et les pronostics du salon.', error);
      this.resultsError.set('Les résultats et pronostics partagés ne sont pas disponibles pour le moment.');
    }
  }
}
