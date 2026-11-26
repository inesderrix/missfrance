import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, OnDestroy, OnInit, PLATFORM_ID, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  Candidate,
  CandidateRating,
  RoomTop12Prediction,
  SupabaseService,
} from '../supabase.service';

interface PlayerTop5Prediction {
  joueurId: string;
  pseudo: string;
  candidateIds: number[];
}

@Component({
  selector: 'app-top5',
  imports: [RouterLink],
  templateUrl: './top5.html',
  styleUrl: './top5.css',
})
export class Top5 implements OnInit, OnDestroy {
  private readonly supabase = inject(SupabaseService);
  private readonly platformId = inject(PLATFORM_ID);
  private refreshTimer?: ReturnType<typeof setInterval>;
  readonly candidates = signal<Candidate[]>([]);
  readonly ratings = signal<Record<number, number>>({});
  readonly qualifiedIds = signal<number[]>([]);
  readonly selectedIds = signal<number[]>([]);
  readonly officialIds = signal<number[]>([]);
  readonly salon = this.supabase.salon;
  readonly isAdmin = computed(() => {
    const salon = this.salon();
    const joueur = this.supabase.joueur();
    return !!salon && !!joueur && salon.admin_id === joueur.user_id;
  });
  readonly top5Locked = computed(
    () => this.salon()?.statut !== 'ouvert' || this.officialIds().length === 5,
  );
  readonly predictions = signal<PlayerTop5Prediction[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly errorMessage = signal('');
  readonly resultsError = signal('');
  readonly search = signal('');
  readonly currentJoueurId = this.supabase.joueur()?.id;
  readonly otherPredictions = computed(() =>
    this.predictions().filter((prediction) => prediction.joueurId !== this.currentJoueurId),
  );
  readonly filteredCandidates = computed(() => {
    const qualifiedIds = new Set(this.qualifiedIds());
    const search = this.search().trim().toLocaleLowerCase('fr');
    return this.candidates().filter(
      (candidate) =>
        qualifiedIds.has(candidate.id) &&
        (!search || candidate.region.toLocaleLowerCase('fr').includes(search)),
    );
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

    const salon = this.supabase.salon();
    const joueur = this.supabase.joueur();
    if (!salon || !joueur) {
      this.errorMessage.set('Rejoins un salon pour préparer ton Top 5.');
      this.loading.set(false);
      return;
    }

    try {
      await this.supabase.refreshSalon(salon.id);
      const [candidates, ratings, qualified, selected, official] = await Promise.all([
        this.supabase.getCandidates(),
        this.supabase.getCandidateRatings(joueur.id),
        this.supabase.getOfficialTop12(salon.id),
        this.supabase.getTop5(joueur.id),
        this.supabase.getOfficialTop5(salon.id),
      ]);
      this.candidates.set(candidates);
      this.ratings.set(this.ratingsByCandidate(ratings));
      this.qualifiedIds.set(qualified.map(({ candidate_id }) => candidate_id));
      this.selectedIds.set(selected);
      this.officialIds.set(official.map(({ candidate_id }) => candidate_id));
      await this.refreshPredictions(salon.id);
    } catch (error) {
      console.error('Impossible de charger le Top 5.', error);
      this.errorMessage.set('Impossible de charger le Top 5. Réessaie plus tard.');
    } finally {
      this.loading.set(false);
    }

    this.refreshTimer = setInterval(() => {
      void this.refreshResults();
    }, 5000);
  }

  ngOnDestroy() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  updateSearch(value: string) {
    this.search.set(value);
  }

  private ratingsByCandidate(ratings: CandidateRating[]): Record<number, number> {
    return Object.fromEntries(
      ratings.map(({ candidate_id, etoiles }) => [candidate_id, etoiles]),
    );
  }

  isSelected(candidateId: number): boolean {
    return this.selectedIds().includes(candidateId);
  }

  async toggleCandidate(candidateId: number) {
    const joueur = this.supabase.joueur();
    if (!joueur || this.saving() || this.top5Locked()) return;
    if (!this.qualifiedIds().includes(candidateId)) return;

    const currentIds = this.selectedIds();
    if (!currentIds.includes(candidateId) && currentIds.length >= 5) {
      this.errorMessage.set('Ton Top 5 est complet. Retire une candidate avant d’en ajouter une autre.');
      return;
    }

    const nextIds = currentIds.includes(candidateId)
      ? currentIds.filter((id) => id !== candidateId)
      : [...currentIds, candidateId];

    this.errorMessage.set('');
    this.saving.set(true);
    try {
      await this.supabase.saveTop5(joueur.id, nextIds);
      this.selectedIds.set(nextIds);
    } catch (error) {
      console.error('Impossible d’enregistrer le Top 5.', error);
      this.errorMessage.set('Ton pronostic Top 5 n’a pas pu être enregistré. Vérifie les droits Supabase.');
    } finally {
      this.saving.set(false);
    }
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

  private async refreshResults() {
    const salon = this.supabase.salon();
    if (!salon) return;

    try {
      await this.supabase.refreshSalon(salon.id);
      const official = await this.supabase.getOfficialTop5(salon.id);
      this.officialIds.set(official.map(({ candidate_id }) => candidate_id));
      await this.refreshPredictions(salon.id);
      this.resultsError.set('');
    } catch (error) {
      console.error('Impossible d’actualiser le résultat Top 5.', error);
      this.resultsError.set('Le résultat Top 5 n’est pas disponible pour le moment.');
    }
  }

  private async refreshPredictions(salonId: string) {
    const predictions: RoomTop12Prediction[] = await this.supabase.getRoomTop5Predictions(salonId);
    const grouped = new Map<string, PlayerTop5Prediction>();
    for (const prediction of predictions) {
      const player = grouped.get(prediction.joueur_id) ?? {
        joueurId: prediction.joueur_id,
        pseudo: prediction.pseudo,
        candidateIds: [],
      };
      player.candidateIds.push(prediction.candidate_id);
      grouped.set(prediction.joueur_id, player);
    }
    this.predictions.set([...grouped.values()]);
  }
}
