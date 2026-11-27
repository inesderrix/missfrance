import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, OnDestroy, OnInit, PLATFORM_ID, signal } from '@angular/core';
import { PageNavigation } from '../page-navigation/page-navigation';
import {
  Candidate,
  RankedCandidate,
  RoomPlayer,
  RoomRankPrediction,
  RoomTop12Prediction,
  SupabaseService,
} from '../supabase.service';

interface PlayerRanking {
  joueurId: string;
  pseudo: string;
  candidateIds: number[];
}

interface PlayerScore {
  joueurId: string;
  pseudo: string;
  top12Points: number;
  top5Points: number;
  dauphinePoints: number;
  missFrancePoints: number;
  total: number;
}

@Component({
  selector: 'app-classement',
  imports: [PageNavigation],
  templateUrl: './classement.html',
  styleUrl: './classement.css',
})
export class Classement implements OnInit, OnDestroy {
  private readonly supabase = inject(SupabaseService);
  private readonly platformId = inject(PLATFORM_ID);
  private refreshTimer?: ReturnType<typeof setInterval>;
  readonly candidates = signal<Candidate[]>([]);
  readonly finalistIds = signal<number[]>([]);
  readonly officialTop12Ids = signal<number[]>([]);
  readonly rankingIds = signal<number[]>([]);
  readonly officialRanking = signal<RankedCandidate[]>([]);
  readonly roomRankings = signal<PlayerRanking[]>([]);
  readonly roomPlayers = signal<RoomPlayer[]>([]);
  readonly roomTop12Predictions = signal<RoomTop12Prediction[]>([]);
  readonly roomTop5Predictions = signal<RoomTop12Prediction[]>([]);
  readonly scoreboard = computed<PlayerScore[]>(() => {
    const top12ByPlayer = this.groupCandidateIds(this.roomTop12Predictions());
    const top5ByPlayer = this.groupCandidateIds(this.roomTop5Predictions());
    const rankingByPlayer = new Map(
      this.roomRankings().map((ranking) => [ranking.joueurId, ranking.candidateIds]),
    );
    const officialTop12 = new Set(this.officialTop12Ids());
    const officialTop5 = new Set(this.finalistIds());
    const officialDauphines = new Set(
      this.officialRanking().filter(({ rang }) => rang >= 2 && rang <= 5)
        .map(({ candidate_id }) => candidate_id),
    );
    const officialMissFrance = this.officialRanking().find(({ rang }) => rang === 1)?.candidate_id;
    const players = new Map(this.roomPlayers().map((player) => [player.id, player.pseudo]));

    for (const prediction of [
      ...this.roomTop12Predictions(),
      ...this.roomTop5Predictions(),
      ...this.roomRankings().flatMap((ranking) =>
        ranking.candidateIds
          .filter((candidateId) => candidateId !== undefined)
          .map((candidate_id) => ({ joueur_id: ranking.joueurId, pseudo: ranking.pseudo, candidate_id })),
      ),
    ]) {
      players.set(prediction.joueur_id, prediction.pseudo);
    }

    return [...players.entries()]
      .map(([joueurId, pseudo]) => {
        const top12Points = (top12ByPlayer.get(joueurId) ?? [])
          .filter((candidateId) => officialTop12.has(candidateId)).length;
        const top5Points = (top5ByPlayer.get(joueurId) ?? [])
          .filter((candidateId) => officialTop5.has(candidateId)).length;
        const rankedCandidates = rankingByPlayer.get(joueurId) ?? [];
        const dauphinePoints =
          rankedCandidates.filter((candidateId, index) => index > 0 && officialDauphines.has(candidateId))
            .length * 2;
        const missFrancePoints =
          officialMissFrance !== undefined && rankedCandidates[0] === officialMissFrance ? 5 : 0;
        return {
          joueurId,
          pseudo,
          top12Points,
          top5Points,
          dauphinePoints,
          missFrancePoints,
          total: top12Points + top5Points + dauphinePoints + missFrancePoints,
        };
      })
      .sort((a, b) => b.total - a.total || a.pseudo.localeCompare(b.pseudo, 'fr'));
  });
  readonly draggedCandidateId = signal<number | null>(null);
  readonly salon = this.supabase.salon;
  readonly isAdmin = computed(() => {
    const salon = this.salon();
    const joueur = this.supabase.joueur();
    return !!salon && !!joueur && salon.admin_id === joueur.user_id;
  });
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly errorMessage = signal('');
  readonly resultsError = signal('');
  readonly currentJoueurId = this.supabase.joueur()?.id;
  readonly otherRankings = computed(() =>
    this.roomRankings().filter((ranking) => ranking.joueurId !== this.currentJoueurId),
  );
  readonly rankingLocked = computed(
    () =>
      this.salon()?.etape !== 'classement' ||
      this.salon()?.statut !== 'ouvert' ||
      this.officialRanking().length === 5,
  );
  readonly editableRankingIds = computed(() => {
    const savedIds = this.rankingIds();
    return [
      ...savedIds,
      ...this.finalistIds().filter((candidateId) => !savedIds.includes(candidateId)),
    ];
  });

  async ngOnInit() {
    if (!isPlatformBrowser(this.platformId)) {
      this.loading.set(false);
      return;
    }

    const salon = this.supabase.salon();
    const joueur = this.supabase.joueur();
    if (!salon || !joueur) {
      this.errorMessage.set('Rejoins un salon pour préparer le classement final.');
      this.loading.set(false);
      return;
    }

    try {
      await this.supabase.refreshSalon(salon.id);
      const [candidates, finalists, officialTop12, ranking, officialRanking] = await Promise.all([
        this.supabase.getCandidates(),
        this.supabase.getOfficialTop5(salon.id),
        this.supabase.getOfficialTop12(salon.id),
        this.supabase.getRanking(joueur.id),
        this.supabase.getOfficialRanking(salon.id),
      ]);
      this.candidates.set(candidates);
      this.finalistIds.set(finalists.map(({ candidate_id }) => candidate_id));
      this.officialTop12Ids.set(officialTop12.map(({ candidate_id }) => candidate_id));
      this.rankingIds.set(ranking);
      this.officialRanking.set(officialRanking);
      if (this.rankingLocked()) await this.refreshRoomResults(salon.id);
    } catch (error) {
      console.error('Impossible de charger le classement final.', error);
      this.errorMessage.set('Impossible de charger le classement. Réessaie plus tard.');
    } finally {
      this.loading.set(false);
    }

    this.refreshTimer = setInterval(() => {
      void this.refreshStage();
    }, 5000);
  }

  ngOnDestroy() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  rankLabel(rank: number): string {
    return [
      '',
      'Miss France',
      '1re dauphine',
      '2e dauphine',
      '3e dauphine',
      '4e dauphine',
    ][rank] ?? `${rank}e place`;
  }

  getCandidate(candidateId: number): Candidate | undefined {
    return this.candidates().find((candidate) => candidate.id === candidateId);
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

  isCorrectRank(candidateId: number, rank: number): boolean {
    return this.officialRanking().some(
      (result) => result.candidate_id === candidateId && result.rang === rank,
    );
  }

  startDragging(candidateId: number) {
    if (this.saving() || this.rankingLocked()) return;
    this.draggedCandidateId.set(candidateId);
  }

  stopDragging() {
    this.draggedCandidateId.set(null);
  }

  allowDrop(event: DragEvent) {
    event.preventDefault();
  }

  async dropOn(candidateId: number) {
    const draggedId = this.draggedCandidateId();
    this.draggedCandidateId.set(null);
    if (!draggedId || draggedId === candidateId || this.saving() || this.rankingLocked()) return;

    const ids = [...this.editableRankingIds()];
    const fromIndex = ids.indexOf(draggedId);
    const toIndex = ids.indexOf(candidateId);
    if (fromIndex < 0 || toIndex < 0) return;
    ids.splice(fromIndex, 1);
    ids.splice(toIndex, 0, draggedId);
    await this.persistRanking(ids);
  }

  async moveCandidate(candidateId: number, direction: -1 | 1) {
    if (this.saving() || this.rankingLocked()) return;
    const ids = [...this.editableRankingIds()];
    const fromIndex = ids.indexOf(candidateId);
    const toIndex = fromIndex + direction;
    if (fromIndex < 0 || toIndex < 0 || toIndex >= ids.length) return;
    ids.splice(fromIndex, 1);
    ids.splice(toIndex, 0, candidateId);
    await this.persistRanking(ids);
  }

  getHitCount(): number {
    const officialByRank = new Map(
      this.officialRanking().map(({ rang, candidate_id }) => [rang, candidate_id]),
    );
    return this.rankingIds().filter(
      (candidateId, index) => officialByRank.get(index + 1) === candidateId,
    ).length;
  }

  private async persistRanking(candidateIds: number[]) {
    const joueur = this.supabase.joueur();
    if (!joueur) return;
    this.saving.set(true);
    this.errorMessage.set('');
    try {
      await this.supabase.saveRanking(joueur.id, candidateIds);
      this.rankingIds.set(candidateIds);
    } catch (error) {
      console.error('Impossible d’enregistrer le classement.', error);
      this.errorMessage.set('Ton classement n’a pas pu être enregistré. Vérifie les droits Supabase.');
    } finally {
      this.saving.set(false);
    }
  }

  private async refreshStage() {
    const salon = this.supabase.salon();
    if (!salon) return;
    try {
      await this.supabase.refreshSalon(salon.id);
      const [finalists, officialTop12, officialRanking] = await Promise.all([
        this.supabase.getOfficialTop5(salon.id),
        this.supabase.getOfficialTop12(salon.id),
        this.supabase.getOfficialRanking(salon.id),
      ]);
      this.finalistIds.set(finalists.map(({ candidate_id }) => candidate_id));
      this.officialTop12Ids.set(officialTop12.map(({ candidate_id }) => candidate_id));
      this.officialRanking.set(officialRanking);
      if (this.rankingLocked()) await this.refreshRoomResults(salon.id);
      this.resultsError.set('');
    } catch (error) {
      console.error('Impossible d’actualiser le classement final.', error);
      this.resultsError.set('Le classement final n’est pas disponible pour le moment.');
    }
  }

  private groupCandidateIds(predictions: RoomTop12Prediction[]): Map<string, number[]> {
    const grouped = new Map<string, number[]>();
    for (const prediction of predictions) {
      const ids = grouped.get(prediction.joueur_id) ?? [];
      ids.push(prediction.candidate_id);
      grouped.set(prediction.joueur_id, ids);
    }
    return grouped;
  }

  private async refreshRoomResults(salonId: string) {
    const [players, top12Predictions, top5Predictions, rankingPredictions]: [
      RoomPlayer[],
      RoomTop12Prediction[],
      RoomTop12Prediction[],
      RoomRankPrediction[],
    ] = await Promise.all([
      this.supabase.getRoomPlayers(salonId),
      this.supabase.getRoomTop12Predictions(salonId),
      this.supabase.getRoomTop5Predictions(salonId),
      this.supabase.getRoomRankingPredictions(salonId),
    ]);
    this.roomPlayers.set(players);
    this.roomTop12Predictions.set(top12Predictions);
    this.roomTop5Predictions.set(top5Predictions);
    const grouped = new Map<string, PlayerRanking>();
    for (const prediction of rankingPredictions) {
      const player = grouped.get(prediction.joueur_id) ?? {
        joueurId: prediction.joueur_id,
        pseudo: prediction.pseudo,
        candidateIds: [],
      };
      player.candidateIds[prediction.rang - 1] = prediction.candidate_id;
      grouped.set(prediction.joueur_id, player);
    }
    this.roomRankings.set([...grouped.values()]);
  }
}
