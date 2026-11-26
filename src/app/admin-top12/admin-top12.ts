import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, OnInit, PLATFORM_ID, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  Candidate,
  OfficialTop12Candidate,
  OfficialTop5Candidate,
  RankedCandidate,
  RoomPlayer,
  RoomRankPrediction,
  RoomTop12Prediction,
  Salon,
  SupabaseService,
} from '../supabase.service';

interface PlayerPrediction {
  joueurId: string;
  pseudo: string;
  candidateIds: number[];
}

interface PlayerRankPrediction {
  joueurId: string;
  pseudo: string;
  candidateIds: number[];
}

interface AdminPlayerScore extends PlayerPrediction {
  top12Points: number;
  top5Points: number;
  dauphinePoints: number;
  missFrancePoints: number;
  total: number;
}

@Component({
  selector: 'app-admin-top12',
  imports: [RouterLink],
  templateUrl: './admin-top12.html',
  styleUrl: './admin-top12.css',
})
export class AdminTop12 implements OnInit {
  private readonly supabase = inject(SupabaseService);
  private readonly platformId = inject(PLATFORM_ID);
  readonly candidates = signal<Candidate[]>([]);
  readonly selectedIds = signal<number[]>([]);
  readonly officialIds = signal<number[]>([]);
  readonly top5Ids = signal<number[]>([]);
  readonly officialTop5Ids = signal<number[]>([]);
  readonly rankingIds = signal<number[]>([]);
  readonly officialRanking = signal<RankedCandidate[]>([]);
  readonly draggedRankingCandidateId = signal<number | null>(null);
  readonly playerPredictions = signal<PlayerPrediction[]>([]);
  readonly top5PlayerPredictions = signal<PlayerPrediction[]>([]);
  readonly rankingPlayerPredictions = signal<PlayerRankPrediction[]>([]);
  readonly salon = this.supabase.salon;
  readonly isAdmin = computed(() => {
    const salon = this.salon();
    const joueur = this.supabase.joueur();
    return !!salon && !!joueur && salon.admin_id === joueur.user_id;
  });
  readonly predictionsLocked = computed(() => {
    const salon = this.salon();
    return !!salon && (salon.statut !== 'ouvert' || this.top12Validated());
  });
  readonly top12Validated = computed(() => this.officialIds().length === 12);
  readonly top5Validated = computed(() => this.officialTop5Ids().length === 5);
  readonly rankingValidated = computed(() => this.officialRanking().length === 5);
  readonly currentStageRoute = computed(() => {
    if (this.top5Validated()) return '/classement';
    if (this.top12Validated()) return '/top5';
    return '/top12';
  });
  readonly scoreboard = computed<AdminPlayerScore[]>(() => {
    const officialTop12 = new Set(this.officialIds());
    const officialTop5 = new Set(this.officialTop5Ids());
    const officialDauphines = new Set(
      this.officialRanking()
        .filter(({ rang }) => rang >= 2 && rang <= 5)
        .map(({ candidate_id }) => candidate_id),
    );
    const officialMissFrance = this.officialRanking().find(({ rang }) => rang === 1)?.candidate_id;
    const top5ByPlayer = new Map(
      this.top5PlayerPredictions().map((player) => [player.joueurId, player.candidateIds]),
    );
    const rankingByPlayer = new Map(
      this.rankingPlayerPredictions().map((player) => [player.joueurId, player.candidateIds]),
    );

    return this.playerPredictions()
      .map((player) => {
        const top12Points = player.candidateIds.filter((id) => officialTop12.has(id)).length;
        const top5Points = (top5ByPlayer.get(player.joueurId) ?? [])
          .filter((id) => officialTop5.has(id)).length;
        const rankedCandidates = rankingByPlayer.get(player.joueurId) ?? [];
        const dauphinePoints = rankedCandidates
          .filter((id, index) => index > 0 && id !== undefined && officialDauphines.has(id))
          .length * 2;
        const missFrancePoints =
          officialMissFrance !== undefined && rankedCandidates[0] === officialMissFrance ? 5 : 0;

        return {
          ...player,
          top12Points,
          top5Points,
          dauphinePoints,
          missFrancePoints,
          total: top12Points + top5Points + dauphinePoints + missFrancePoints,
        };
      })
      .sort((a, b) => b.total - a.total || a.pseudo.localeCompare(b.pseudo, 'fr'));
  });
  readonly loading = signal(true);
  readonly locking = signal(false);
  readonly saving = signal(false);
  readonly errorMessage = signal('');
  readonly search = signal('');
  readonly filteredCandidates = computed(() => {
    const search = this.search().trim().toLocaleLowerCase('fr');
    return this.candidates().filter(
      (candidate) =>
        !search || candidate.region.toLocaleLowerCase('fr').includes(search),
    );
  });

  async ngOnInit() {
    if (!isPlatformBrowser(this.platformId)) {
      this.loading.set(false);
      return;
    }

    const currentSalon = this.salon();
    const joueur = this.supabase.joueur();
    if (!currentSalon || !joueur) {
      this.errorMessage.set('Rejoins ou crée un salon pour accéder à l’administration.');
      this.loading.set(false);
      return;
    }

    try {
      const salon = await this.supabase.refreshSalon(currentSalon.id);
      if (salon.admin_id !== joueur.user_id) {
        this.errorMessage.set('Cet écran est réservé à la personne qui a créé le salon.');
        return;
      }

      const [candidates, officialResults, officialTop5, officialRanking] = await Promise.all([
        this.supabase.getCandidates(),
        this.supabase.getOfficialTop12(salon.id),
        this.supabase.getOfficialTop5(salon.id),
        this.supabase.getOfficialRanking(salon.id),
      ]);
      this.candidates.set(candidates);
      const officialIds = officialResults.map(({ candidate_id }) => candidate_id);
      this.officialIds.set(officialIds);
      this.selectedIds.set(officialIds);
      const top5Ids = officialTop5.map(({ candidate_id }) => candidate_id);
      this.officialTop5Ids.set(top5Ids);
      this.top5Ids.set(top5Ids);
      this.officialRanking.set(officialRanking);
      this.rankingIds.set(
        officialRanking.length === 5
          ? officialRanking.map(({ candidate_id }) => candidate_id)
          : salon.statut !== 'ouvert' && top5Ids.length === 5
            ? [...top5Ids]
            : [],
      );

      const predictionLoads: Promise<void>[] = [];
      if (salon.statut !== 'ouvert' || officialIds.length === 12) {
        predictionLoads.push(this.loadPlayerPredictions(salon.id));
      }
      if (top5Ids.length === 5 || (officialIds.length === 12 && salon.statut !== 'ouvert')) {
        predictionLoads.push(this.loadTop5PlayerPredictions(salon.id));
      }
      if (top5Ids.length === 5 && (salon.statut === 'verrouille' || salon.statut === 'termine')) {
        predictionLoads.push(this.loadRankingPlayerPredictions(salon.id));
      }
      await Promise.all(predictionLoads);
    } catch (error) {
      console.error('Impossible de charger l’administration du salon.', error);
      this.errorMessage.set('Impossible de charger les données du salon. Réessaie plus tard.');
    } finally {
      this.loading.set(false);
    }
  }

  updateSearch(value: string) {
    this.search.set(value);
  }

  isSelected(candidateId: number): boolean {
    return this.selectedIds().includes(candidateId);
  }

  async lockPredictions() {
    const salon = this.salon();
    if (!salon || !this.isAdmin() || salon.statut !== 'ouvert' || this.locking()) return;

    this.errorMessage.set('');
    this.locking.set(true);
    try {
      await this.supabase.lockSalon(salon.id);
      const updatedSalon = await this.supabase.refreshSalon(salon.id);
      if (updatedSalon.statut !== 'verrouille') {
        throw new Error('Le salon n’a pas confirmé le verrouillage.');
      }
      await this.loadPlayerPredictions(salon.id);
    } catch (error) {
      console.error('Impossible de verrouiller les pronostics.', error);
      this.errorMessage.set(
        error instanceof Error ? error.message : 'Le verrouillage a échoué. Réessaie.',
      );
    } finally {
      this.locking.set(false);
    }
  }

  toggleCandidate(candidateId: number) {
    const salon = this.salon();
    if (!salon || salon.statut !== 'verrouille' || this.officialIds().length === 12 || this.saving()) {
      return;
    }

    const ids = this.selectedIds();
    if (ids.includes(candidateId)) {
      this.selectedIds.set(ids.filter((id) => id !== candidateId));
    } else if (ids.length < 12) {
      this.selectedIds.set([...ids, candidateId]);
    }
  }

  isTop5Selected(candidateId: number): boolean {
    return this.top5Ids().includes(candidateId);
  }

  toggleTop5Candidate(candidateId: number) {
    if (
      this.officialTop5Ids().length === 5 ||
      this.saving() ||
      !this.officialIds().includes(candidateId)
    ) {
      return;
    }

    const ids = this.top5Ids();
    if (ids.includes(candidateId)) {
      this.top5Ids.set(ids.filter((id) => id !== candidateId));
    } else if (ids.length < 5) {
      this.top5Ids.set([...ids, candidateId]);
    }
  }

  async publishTop5() {
    const salon = this.salon();
    if (
      !salon ||
      !this.isAdmin() ||
      salon.statut === 'ouvert' ||
      this.officialIds().length !== 12 ||
      this.top5Ids().length !== 5 ||
      this.officialTop5Ids().length === 5 ||
      this.saving()
    ) {
      return;
    }

    this.errorMessage.set('');
    this.saving.set(true);
    try {
      await this.supabase.saveOfficialTop5(salon.id, this.top5Ids());
      const officialTop5: OfficialTop5Candidate[] =
        await this.supabase.getOfficialTop5(salon.id);
      const ids = officialTop5.map(({ candidate_id }) => candidate_id);
      this.officialTop5Ids.set(ids);
      this.top5Ids.set(ids);
      if (ids.length === 5) {
        await this.supabase.openSalonForRanking(salon.id);
        await this.supabase.refreshSalon(salon.id);
        await this.loadTop5PlayerPredictions(salon.id);
      }
    } catch (error) {
      console.error('Impossible de valider le Top 5 officiel.', error);
      this.errorMessage.set(
        error instanceof Error ? error.message : 'Le Top 5 officiel n’a pas été enregistré.',
      );
    } finally {
      this.saving.set(false);
    }
  }

  isRankingSelected(candidateId: number): boolean {
    return this.rankingIds().includes(candidateId);
  }

  addRankingCandidate(candidateId: number) {
    if (
      this.saving() ||
      this.rankingValidated() ||
      !this.officialTop5Ids().includes(candidateId) ||
      this.rankingIds().includes(candidateId) ||
      this.rankingIds().length >= 5
    ) {
      return;
    }
    this.rankingIds.set([...this.rankingIds(), candidateId]);
  }

  removeRankingCandidate(candidateId: number) {
    if (this.saving() || this.rankingValidated()) return;
    this.rankingIds.update((ids) => ids.filter((id) => id !== candidateId));
  }

  startRankingDrag(candidateId: number) {
    if (this.saving() || this.rankingValidated()) return;
    this.draggedRankingCandidateId.set(candidateId);
  }

  stopRankingDrag() {
    this.draggedRankingCandidateId.set(null);
  }

  allowRankingDrop(event: DragEvent) {
    event.preventDefault();
  }

  dropRankingCandidate(targetCandidateId: number) {
    const draggedCandidateId = this.draggedRankingCandidateId();
    this.draggedRankingCandidateId.set(null);
    if (!draggedCandidateId || draggedCandidateId === targetCandidateId || this.saving()) return;

    const ids = [...this.rankingIds()];
    const sourceIndex = ids.indexOf(draggedCandidateId);
    const targetIndex = ids.indexOf(targetCandidateId);
    if (sourceIndex < 0 || targetIndex < 0) return;

    ids.splice(sourceIndex, 1);
    ids.splice(targetIndex, 0, draggedCandidateId);
    this.rankingIds.set(ids);
  }

  moveRankingCandidate(candidateId: number, direction: -1 | 1) {
    if (this.saving()) return;
    const ids = [...this.rankingIds()];
    const sourceIndex = ids.indexOf(candidateId);
    const targetIndex = sourceIndex + direction;
    if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= ids.length) return;

    ids.splice(sourceIndex, 1);
    ids.splice(targetIndex, 0, candidateId);
    this.rankingIds.set(ids);
  }

  async lockRankingPredictions() {
    const salon = this.salon();
    if (
      !salon ||
      !this.isAdmin() ||
      salon.statut !== 'ouvert' ||
      !this.top5Validated() ||
      this.locking()
    ) {
      return;
    }

    this.errorMessage.set('');
    this.locking.set(true);
    try {
      await this.supabase.lockSalonForRanking(salon.id);
      await this.supabase.refreshSalon(salon.id);
      this.rankingIds.set([...this.officialTop5Ids()]);
      await this.loadRankingPlayerPredictions(salon.id);
    } catch (error) {
      console.error('Impossible de verrouiller les pronostics du classement.', error);
      this.errorMessage.set(
        error instanceof Error ? error.message : 'Le verrouillage du classement a échoué.',
      );
    } finally {
      this.locking.set(false);
    }
  }

  async reopenForRanking() {
    const salon = this.salon();
    if (
      !salon ||
      !this.isAdmin() ||
      salon.statut !== 'verrouille' ||
      !this.top5Validated() ||
      this.saving()
    ) {
      return;
    }

    this.errorMessage.set('');
    this.saving.set(true);
    try {
      await this.supabase.openSalonForRanking(salon.id);
      await this.supabase.refreshSalon(salon.id);
    } catch (error) {
      console.error('Impossible d’ouvrir les pronostics du classement.', error);
      this.errorMessage.set(
        error instanceof Error ? error.message : 'Les pronostics du classement n’ont pas pu être ouverts.',
      );
    } finally {
      this.saving.set(false);
    }
  }

  async publishRanking() {
    const salon = this.salon();
    if (
      !salon ||
      !this.isAdmin() ||
      salon.statut !== 'verrouille' ||
      this.rankingIds().length !== 5 ||
      this.rankingValidated() ||
      this.saving()
    ) {
      return;
    }

    this.errorMessage.set('');
    this.saving.set(true);
    try {
      await this.supabase.saveOfficialRanking(salon.id, this.rankingIds());
      const officialRanking = await this.supabase.getOfficialRanking(salon.id);
      this.officialRanking.set(officialRanking);
      this.rankingIds.set(officialRanking.map(({ candidate_id }) => candidate_id));
      await this.supabase.finishSalon(salon.id);
      await this.supabase.refreshSalon(salon.id);
      await this.loadRankingPlayerPredictions(salon.id);
    } catch (error) {
      console.error('Impossible de valider le classement officiel.', error);
      this.errorMessage.set(
        error instanceof Error ? error.message : 'Le classement officiel n’a pas été enregistré.',
      );
    } finally {
      this.saving.set(false);
    }
  }

  async lockTop5Predictions() {
    const salon = this.salon();
    if (
      !salon ||
      !this.isAdmin() ||
      salon.statut !== 'ouvert' ||
      !this.top12Validated() ||
      this.locking()
    ) {
      return;
    }

    this.errorMessage.set('');
    this.locking.set(true);
    try {
      await this.supabase.lockSalonForTop5(salon.id);
      const updatedSalon = await this.supabase.refreshSalon(salon.id);
      if (updatedSalon.statut !== 'verrouille') {
        throw new Error('Le salon n’a pas confirmé le verrouillage des pronostics Top 5.');
      }
      await this.loadTop5PlayerPredictions(salon.id);
      await this.loadTop5PlayerPredictions(salon.id);
    } catch (error) {
      console.error('Impossible de verrouiller les pronostics Top 5.', error);
      this.errorMessage.set(
        error instanceof Error ? error.message : 'Le verrouillage des pronostics Top 5 a échoué.',
      );
    } finally {
      this.locking.set(false);
    }
  }

  async publishTop12() {
    const salon = this.salon();
    if (
      !salon ||
      !this.isAdmin() ||
      salon.statut !== 'verrouille' ||
      this.selectedIds().length !== 12 ||
      this.saving()
    ) {
      return;
    }

    this.errorMessage.set('');
    this.saving.set(true);
    try {
      await this.supabase.saveOfficialTop12(salon.id, this.selectedIds());
      const officialResults: OfficialTop12Candidate[] =
        await this.supabase.getOfficialTop12(salon.id);
      const officialIds = officialResults.map(({ candidate_id }) => candidate_id);
      this.officialIds.set(officialIds);
      if (officialIds.length === 12) {
        await this.supabase.openSalonForTop5(salon.id);
        await this.supabase.refreshSalon(salon.id);
      }
    } catch (error) {
      console.error('Impossible de valider le Top 12 officiel.', error);
      this.errorMessage.set(
        error instanceof Error ? error.message : 'Le Top 12 officiel n’a pas été enregistré.',
      );
    } finally {
      this.saving.set(false);
    }
  }

  async reopenForTop5() {
    const salon = this.salon();
    if (
      !salon ||
      !this.isAdmin() ||
      salon.statut !== 'verrouille' ||
      !this.top12Validated() ||
      this.saving()
    ) {
      return;
    }

    this.errorMessage.set('');
    this.saving.set(true);
    try {
      await this.supabase.openSalonForTop5(salon.id);
      await this.supabase.refreshSalon(salon.id);
    } catch (error) {
      console.error('Impossible d’ouvrir les pronostics du Top 5.', error);
      this.errorMessage.set(
        error instanceof Error ? error.message : 'Les pronostics du Top 5 n’ont pas pu être ouverts.',
      );
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

  getCandidateRegions(candidateIds: number[]): string {
    const candidates = new Map(this.candidates().map((candidate) => [candidate.id, candidate]));
    return candidateIds
      .map((candidateId) => candidates.get(candidateId))
      .filter((candidate): candidate is Candidate => candidate !== undefined)
      .map((candidate) => candidate.region)
      .join(', ');
  }

  getCandidate(candidateId: number): Candidate | undefined {
    return this.candidates().find((candidate) => candidate.id === candidateId);
  }

  rankingLabel(rank: number): string {
    return [
      '',
      'Miss France',
      '1re dauphine',
      '2e dauphine',
      '3e dauphine',
      '4e dauphine',
    ][rank] ?? `${rank}e place`;
  }

  private async loadPlayerPredictions(salonId: string) {
    const [players, predictions]: [RoomPlayer[], RoomTop12Prediction[]] = await Promise.all([
      this.supabase.getRoomPlayers(salonId),
      this.supabase.getRoomTop12Predictions(salonId),
    ]);
    this.playerPredictions.set(this.groupUnrankedPredictions(players, predictions));
  }

  private async loadTop5PlayerPredictions(salonId: string) {
    const [players, predictions]: [RoomPlayer[], RoomTop12Prediction[]] = await Promise.all([
      this.supabase.getRoomPlayers(salonId),
      this.supabase.getRoomTop5Predictions(salonId),
    ]);
    this.top5PlayerPredictions.set(this.groupUnrankedPredictions(players, predictions));
  }

  private groupUnrankedPredictions(
    players: RoomPlayer[],
    predictions: RoomTop12Prediction[],
  ): PlayerPrediction[] {
    const grouped = new Map<string, PlayerPrediction>();

    for (const player of players) {
      grouped.set(player.id, {
        joueurId: player.id,
        pseudo: player.pseudo,
        candidateIds: [],
      });
    }

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

  private async loadRankingPlayerPredictions(salonId: string) {
    const [players, predictions]: [RoomPlayer[], RoomRankPrediction[]] = await Promise.all([
      this.supabase.getRoomPlayers(salonId),
      this.supabase.getRoomRankingPredictions(salonId),
    ]);
    const grouped = new Map<string, PlayerRankPrediction>();
    for (const player of players) {
      grouped.set(player.id, {
        joueurId: player.id,
        pseudo: player.pseudo,
        candidateIds: [],
      });
    }
    for (const prediction of predictions) {
      const player = grouped.get(prediction.joueur_id);
      if (player) player.candidateIds[prediction.rang - 1] = prediction.candidate_id;
    }
    this.rankingPlayerPredictions.set([...grouped.values()]);
  }
}
