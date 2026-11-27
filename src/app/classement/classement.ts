import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, OnDestroy, OnInit, PLATFORM_ID, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PageNavigation } from '../page-navigation/page-navigation';
import {
  Candidate,
  RankedCandidate,
  SupabaseService,
} from '../supabase.service';

@Component({
  selector: 'app-classement',
  imports: [PageNavigation, RouterLink],
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
      this.resultsError.set('');
    } catch (error) {
      console.error('Impossible d’actualiser le classement final.', error);
      this.resultsError.set('Le classement final n’est pas disponible pour le moment.');
    }
  }

}
