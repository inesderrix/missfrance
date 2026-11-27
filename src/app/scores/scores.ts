import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, OnDestroy, OnInit, PLATFORM_ID, signal } from '@angular/core';
import { PageNavigation } from '../page-navigation/page-navigation';
import {
  RankedCandidate,
  RoomPlayer,
  RoomRankPrediction,
  RoomTop12Prediction,
  getRankingPoints,
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
  selector: 'app-scores',
  imports: [PageNavigation],
  templateUrl: './scores.html',
  styleUrl: './scores.css',
})
export class Scores implements OnInit, OnDestroy {
  private readonly supabase = inject(SupabaseService);
  private readonly platformId = inject(PLATFORM_ID);
  private refreshTimer?: ReturnType<typeof setInterval>;
  private refreshing = false;
  readonly roomRankings = signal<PlayerRanking[]>([]);
  readonly roomPlayers = signal<RoomPlayer[]>([]);
  readonly roomTop12Predictions = signal<RoomTop12Prediction[]>([]);
  readonly roomTop5Predictions = signal<RoomTop12Prediction[]>([]);
  readonly officialTop12Ids = signal<number[]>([]);
  readonly officialTop5Ids = signal<number[]>([]);
  readonly officialRanking = signal<RankedCandidate[]>([]);
  readonly currentJoueurId = this.supabase.joueur()?.id;
  readonly loading = signal(true);
  readonly errorMessage = signal('');
  readonly resultsError = signal('');
  readonly resultsPublished = computed(() => this.officialRanking().length === 5);
  readonly scoreboard = computed<PlayerScore[]>(() => {
    const top12ByPlayer = this.groupCandidateIds(this.roomTop12Predictions());
    const top5ByPlayer = this.groupCandidateIds(this.roomTop5Predictions());
    const rankingByPlayer = new Map(
      this.roomRankings().map((ranking) => [ranking.joueurId, ranking.candidateIds]),
    );
    const officialTop12 = new Set(this.officialTop12Ids());
    const officialTop5 = new Set(this.officialTop5Ids());
    const players = new Map(this.roomPlayers().map((player) => [player.id, player.pseudo]));

    for (const prediction of [
      ...this.roomTop12Predictions(),
      ...this.roomTop5Predictions(),
      ...this.roomRankings().flatMap((ranking) =>
        ranking.candidateIds
          .filter((candidateId) => candidateId !== undefined)
          .map((candidate_id) => ({
            joueur_id: ranking.joueurId,
            pseudo: ranking.pseudo,
            candidate_id,
          })),
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
        const { dauphinePoints, missFrancePoints } = getRankingPoints(
          rankingByPlayer.get(joueurId) ?? [],
          this.officialRanking(),
        );
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

  async ngOnInit() {
    if (!isPlatformBrowser(this.platformId)) {
      this.loading.set(false);
      return;
    }

    const salon = this.supabase.salon();
    if (!salon || !this.supabase.joueur()) {
      this.errorMessage.set('Rejoins un salon pour consulter le récapitulatif des scores.');
      this.loading.set(false);
      return;
    }

    await this.refreshScores();
    this.refreshTimer = setInterval(() => void this.refreshScores(), 5000);
  }

  ngOnDestroy() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  private async refreshScores() {
    const salon = this.supabase.salon();
    if (!salon || this.refreshing) return;

    this.refreshing = true;
    try {
      const currentSalon = await this.supabase.refreshSalon(salon.id);
      const [
        players,
        officialTop12,
        officialTop5,
        officialRanking,
        top12Predictions,
        top5Predictions,
        rankingPredictions,
      ] = await Promise.all([
        this.supabase.getRoomPlayers(currentSalon.id),
        this.supabase.getOfficialTop12(currentSalon.id),
        this.supabase.getOfficialTop5(currentSalon.id),
        this.supabase.getOfficialRanking(currentSalon.id),
        this.supabase.getRoomTop12Predictions(currentSalon.id),
        this.supabase.getRoomTop5Predictions(currentSalon.id),
        this.supabase.getRoomRankingPredictions(currentSalon.id),
      ]);

      this.roomPlayers.set(players);
      this.officialTop12Ids.set(officialTop12.map(({ candidate_id }) => candidate_id));
      this.officialTop5Ids.set(officialTop5.map(({ candidate_id }) => candidate_id));
      this.officialRanking.set(officialRanking);
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
      this.resultsError.set('');
    } catch (error) {
      console.error('Impossible de charger le récapitulatif des scores.', error);
      if (this.loading()) {
        this.errorMessage.set('Impossible de charger les scores. Réessaie plus tard.');
      } else {
        this.resultsError.set('Les scores ne sont pas disponibles pour le moment.');
      }
    } finally {
      this.loading.set(false);
      this.refreshing = false;
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
}
