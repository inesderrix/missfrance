import { isPlatformBrowser } from '@angular/common';
import { computed, inject, Injectable, PLATFORM_ID, signal } from '@angular/core';
import { createClient } from '@supabase/supabase-js';
import { environment } from '../environments/environment';

export interface Salon {
    id: string;
    code: string;
    nom: string;
    admin_id: string;
    statut: 'ouvert' | 'verrouille' | 'termine';
    etape: SalonStage;
}

export type SalonStage = 'premiere_impression' | 'top12' | 'top5' | 'classement';

export function getSalonStageRoute(etape: SalonStage): string {
    return {
        premiere_impression: '/premiere-impression',
        top12: '/top12',
        top5: '/top5',
        classement: '/classement',
    }[etape];
}

export interface Joueur {
    id: string;
    salon_id: string;
    user_id: string;
    pseudo: string;
}

export interface Candidate {
    id: number;
    nom: string;
    prenom: string;
    age: number;
    region: string;
    photo_url: string | null;
}

export interface CandidateRating {
    candidate_id: number;
    etoiles: number;
}

export interface OfficialTop12Candidate {
    candidate_id: number;
    categorie: 'top12';
    rang: null;
}

export interface OfficialTop5Candidate {
    candidate_id: number;
    categorie: 'top5';
    rang: null;
}

export interface RankedCandidate {
    candidate_id: number;
    rang: number;
}

export interface RoomRankPrediction extends RankedCandidate {
    joueur_id: string;
    pseudo: string;
}

export interface RoomTop12Prediction {
    joueur_id: string;
    pseudo: string;
    candidate_id: number;
}

export interface RoomPlayer {
    id: string;
    pseudo: string;
}

@Injectable({ providedIn: 'root' })
export class SupabaseService {
    client = createClient(environment.supabaseUrl, environment.supabaseKey);
    private readonly platformId = inject(PLATFORM_ID);
    readonly salon = signal<Salon | null>(this.readStoredValue<Salon>('salon'));
    readonly joueur = signal<Joueur | null>(this.readStoredValue<Joueur>('joueur'));
    readonly hasSavedGame = computed(() => !!this.salon() && !!this.joueur());

    async getCandidates(): Promise<Candidate[]> {
        const { data, error } = await this.client.from('candidates').select('*');
        if (error) throw error;
        return data as Candidate[];
    }

    async getCandidateRatings(joueurId: string): Promise<CandidateRating[]> {
        const { data, error } = await this.client
            .from('notes')
            .select('candidate_id, etoiles')
            .eq('joueur_id', joueurId);
        if (error) throw error;
        return data as CandidateRating[];
    }

    async saveCandidateRating(joueurId: string, candidateId: number, etoiles: number) {
        const { error } = await this.client
            .from('notes')
            .upsert(
                { joueur_id: joueurId, candidate_id: candidateId, etoiles },
                { onConflict: 'joueur_id,candidate_id' },
            );
        if (error) throw error;
    }

    async getTop12(joueurId: string): Promise<number[]> {
        const { data, error } = await this.client
            .from('pronostics')
            .select('candidate_id')
            .eq('joueur_id', joueurId)
            .eq('categorie', 'top12');
        if (error) throw error;
        return data.map((pronostic) => pronostic.candidate_id);
    }

    async saveTop12(joueurId: string, candidateIds: number[]) {
        const { error: deleteError } = await this.client
            .from('pronostics')
            .delete()
            .eq('joueur_id', joueurId)
            .eq('categorie', 'top12');
        if (deleteError) throw deleteError;

        const rows = candidateIds.map((id) => ({
            joueur_id: joueurId,
            candidate_id: id,
            categorie: 'top12',
        }));
        if (rows.length === 0) return;

        const { error: insertError } = await this.client.from('pronostics').insert(rows);
        if (insertError) throw insertError;
    }

    async getTop5(joueurId: string): Promise<number[]> {
        const { data, error } = await this.client
            .from('pronostics')
            .select('candidate_id')
            .eq('joueur_id', joueurId)
            .eq('categorie', 'top5');
        if (error) throw error;
        return data.map((pronostic) => pronostic.candidate_id);
    }

    async getRanking(joueurId: string): Promise<number[]> {
        const { data, error } = await this.client
            .from('pronostics')
            .select('candidate_id, rang')
            .eq('joueur_id', joueurId)
            .eq('categorie', 'classement')
            .order('rang', { ascending: true });
        if (error) throw error;
        return data.map((prediction) => prediction.candidate_id);
    }

    async saveRanking(joueurId: string, candidateIds: number[]) {
        const { error: deleteError } = await this.client
            .from('pronostics')
            .delete()
            .eq('joueur_id', joueurId)
            .eq('categorie', 'classement');
        if (deleteError) throw deleteError;

        const rows = candidateIds.map((candidateId, index) => ({
            joueur_id: joueurId,
            candidate_id: candidateId,
            categorie: 'classement',
            rang: index + 1,
        }));
        if (rows.length === 0) return;

        const { error: insertError } = await this.client.from('pronostics').insert(rows);
        if (insertError) throw insertError;
    }

    async saveTop5(joueurId: string, candidateIds: number[]) {
        const { error: deleteError } = await this.client
            .from('pronostics')
            .delete()
            .eq('joueur_id', joueurId)
            .eq('categorie', 'top5');
        if (deleteError) throw deleteError;

        const rows = candidateIds.map((id) => ({
            joueur_id: joueurId,
            candidate_id: id,
            categorie: 'top5',
        }));
        if (rows.length === 0) return;

        const { error: insertError } = await this.client.from('pronostics').insert(rows);
        if (insertError) throw insertError;
    }

    async lockSalon(salonId: string) {
        const { data, error } = await this.client
            .from('salons')
            .update({ statut: 'verrouille' })
            .eq('id', salonId)
            .eq('etape', 'top12')
            .eq('statut', 'ouvert')
            .select('id')
            .maybeSingle();
        if (error) throw error;
        if (!data) throw new Error('Le salon n’a pas pu être verrouillé. Vérifie les droits et son statut.');
        this.updateStoredSalonStatus('verrouille');
    }

    async advanceSalonToTop12(salonId: string) {
        const joueur = this.joueur();
        if (!joueur) throw new Error('Rejoins le salon avant de changer son étape.');

        const { data, error } = await this.client
            .from('salons')
            .update({ etape: 'top12' })
            .eq('id', salonId)
            .eq('admin_id', joueur.user_id)
            .eq('etape', 'premiere_impression')
            .eq('statut', 'ouvert')
            .select('id')
            .maybeSingle();
        if (error) throw error;
        if (!data) throw new Error('Le salon n’a pas pu passer au Top 12. Vérifie tes droits et son étape.');
        this.updateStoredSalon({ etape: 'top12' });
    }

    async openSalonForTop5(salonId: string) {
        const officialTop12 = await this.getOfficialTop12(salonId);
        if (officialTop12.length !== 12) {
            throw new Error('Le Top 12 doit être validé avant d’ouvrir les pronostics du Top 5.');
        }

        const { data, error } = await this.client
            .from('salons')
            .update({ statut: 'ouvert', etape: 'top5' })
            .eq('id', salonId)
            .eq('etape', 'top12')
            .eq('statut', 'verrouille')
            .select('id')
            .maybeSingle();
        if (error) throw error;
        if (!data) {
            throw new Error('Le salon n’a pas pu être rouvert pour le Top 5. Vérifie ses droits et son statut.');
        }
        this.updateStoredSalon({ statut: 'ouvert', etape: 'top5' });
    }

    async lockSalonForTop5(salonId: string) {
        const officialTop12 = await this.getOfficialTop12(salonId);
        if (officialTop12.length !== 12) {
            throw new Error('Le Top 12 doit être validé avant de verrouiller les pronostics du Top 5.');
        }

        const { data, error } = await this.client
            .from('salons')
            .update({ statut: 'verrouille' })
            .eq('id', salonId)
            .eq('etape', 'top5')
            .eq('statut', 'ouvert')
            .select('id')
            .maybeSingle();
        if (error) throw error;
        if (!data) {
            throw new Error('Les pronostics du Top 5 n’ont pas pu être verrouillés. Vérifie les droits et le statut du salon.');
        }
        this.updateStoredSalonStatus('verrouille');
    }

    async openSalonForRanking(salonId: string) {
        const officialTop5 = await this.getOfficialTop5(salonId);
        if (officialTop5.length !== 5) {
            throw new Error('Le Top 5 officiel doit être validé avant d’ouvrir les pronostics du classement.');
        }

        const { data, error } = await this.client
            .from('salons')
            .update({ statut: 'ouvert', etape: 'classement' })
            .eq('id', salonId)
            .eq('etape', 'top5')
            .eq('statut', 'verrouille')
            .select('id')
            .maybeSingle();
        if (error) throw error;
        if (!data) {
            throw new Error('Le salon n’a pas pu être rouvert pour le classement. Vérifie ses droits et son statut.');
        }
        this.updateStoredSalon({ statut: 'ouvert', etape: 'classement' });
    }

    async lockSalonForRanking(salonId: string) {
        const officialTop5 = await this.getOfficialTop5(salonId);
        if (officialTop5.length !== 5) {
            throw new Error('Le Top 5 officiel doit être validé avant de verrouiller le classement.');
        }

        const { data, error } = await this.client
            .from('salons')
            .update({ statut: 'verrouille' })
            .eq('id', salonId)
            .eq('etape', 'classement')
            .eq('statut', 'ouvert')
            .select('id')
            .maybeSingle();
        if (error) throw error;
        if (!data) {
            throw new Error('Le classement n’a pas pu être verrouillé. Vérifie les droits et le statut du salon.');
        }
        this.updateStoredSalonStatus('verrouille');
    }

    async finishSalon(salonId: string) {
        const { data, error } = await this.client
            .from('salons')
            .update({ statut: 'termine' })
            .eq('id', salonId)
            .eq('etape', 'classement')
            .eq('statut', 'verrouille')
            .select('id')
            .maybeSingle();
        if (error) throw error;
        if (!data) {
            throw new Error('Le salon n’a pas pu être terminé. Vérifie ses droits et son statut.');
        }
        this.updateStoredSalon({ statut: 'termine' });
    }

    async refreshSalon(salonId: string): Promise<Salon> {
        const { data, error } = await this.client
            .from('salons')
            .select('id, code, nom, admin_id, statut, etape')
            .eq('id', salonId)
            .single();
        if (error) throw error;
        this.salon.set(data as Salon);
        this.persistSalon(data as Salon);
        return data as Salon;
    }

    async getOfficialTop12(salonId: string): Promise<OfficialTop12Candidate[]> {
        const { data, error } = await this.client
            .from('resultats')
            .select('candidate_id, categorie, rang')
            .eq('salon_id', salonId)
            .eq('categorie', 'top12');
        if (error) throw error;
        return data as OfficialTop12Candidate[];
    }

    async getOfficialTop5(salonId: string): Promise<OfficialTop5Candidate[]> {
        const { data, error } = await this.client
            .from('resultats')
            .select('candidate_id, categorie, rang')
            .eq('salon_id', salonId)
            .eq('categorie', 'top5');
        if (error) throw error;
        return data as OfficialTop5Candidate[];
    }

    async getOfficialRanking(salonId: string): Promise<RankedCandidate[]> {
        const { data, error } = await this.client
            .from('resultats')
            .select('candidate_id, rang')
            .eq('salon_id', salonId)
            .eq('categorie', 'classement')
            .order('rang', { ascending: true });
        if (error) throw error;
        return data as RankedCandidate[];
    }

    async saveOfficialTop12(salonId: string, candidateIds: number[]) {
        const { error: deleteError } = await this.client
            .from('resultats')
            .delete()
            .eq('salon_id', salonId)
            .eq('categorie', 'top12');
        if (deleteError) throw deleteError;

        const rows = candidateIds.map((candidateId) => ({
            salon_id: salonId,
            candidate_id: candidateId,
            categorie: 'top12',
            rang: null,
        }));
        const { error: insertError } = await this.client.from('resultats').insert(rows);
        if (insertError) throw insertError;
    }

    async saveOfficialTop5(salonId: string, candidateIds: number[]) {
        const { error: deleteError } = await this.client
            .from('resultats')
            .delete()
            .eq('salon_id', salonId)
            .eq('categorie', 'top5');
        if (deleteError) throw deleteError;

        const rows = candidateIds.map((candidateId) => ({
            salon_id: salonId,
            candidate_id: candidateId,
            categorie: 'top5',
            rang: null,
        }));
        const { error: insertError } = await this.client.from('resultats').insert(rows);
        if (insertError) throw insertError;
    }

    async saveOfficialRanking(salonId: string, candidateIds: number[]) {
        const { error: deleteError } = await this.client
            .from('resultats')
            .delete()
            .eq('salon_id', salonId)
            .eq('categorie', 'classement');
        if (deleteError) throw deleteError;

        const rows = candidateIds.map((candidateId, index) => ({
            salon_id: salonId,
            candidate_id: candidateId,
            categorie: 'classement',
            rang: index + 1,
        }));
        const { error: insertError } = await this.client.from('resultats').insert(rows);
        if (insertError) throw insertError;
    }

    async getRoomTop12Predictions(salonId: string): Promise<RoomTop12Prediction[]> {
        return this.getRoomPredictions(salonId, 'top12');
    }

    async getRoomPlayers(salonId: string): Promise<RoomPlayer[]> {
        const { data, error } = await this.client
            .from('joueurs')
            .select('id, pseudo')
            .eq('salon_id', salonId);
        if (error) throw error;
        return data ?? [];
    }

    async getRoomTop5Predictions(salonId: string): Promise<RoomTop12Prediction[]> {
        return this.getRoomPredictions(salonId, 'top5');
    }

    async getRoomRankingPredictions(salonId: string): Promise<RoomRankPrediction[]> {
        const { data: players, error: playersError } = await this.client
            .from('joueurs')
            .select('id, pseudo')
            .eq('salon_id', salonId);
        if (playersError) throw playersError;
        if (!players?.length) return [];

        const { data: predictions, error: predictionsError } = await this.client
            .from('pronostics')
            .select('joueur_id, candidate_id, rang')
            .in('joueur_id', players.map((player) => player.id))
            .eq('categorie', 'classement')
            .order('rang', { ascending: true });
        if (predictionsError) throw predictionsError;

        const pseudoByPlayerId = new Map(players.map((player) => [player.id, player.pseudo]));
        return (predictions ?? []).map((prediction) => ({
            joueur_id: prediction.joueur_id,
            pseudo: pseudoByPlayerId.get(prediction.joueur_id) ?? 'Joueur',
            candidate_id: prediction.candidate_id,
            rang: prediction.rang,
        }));
    }

    private async getRoomPredictions(
        salonId: string,
        categorie: 'top12' | 'top5',
    ): Promise<RoomTop12Prediction[]> {
        const { data: players, error: playersError } = await this.client
            .from('joueurs')
            .select('id, pseudo')
            .eq('salon_id', salonId);
        if (playersError) throw playersError;
        if (!players?.length) return [];

        const { data: predictions, error: predictionsError } = await this.client
            .from('pronostics')
            .select('joueur_id, candidate_id')
            .in('joueur_id', players.map((player) => player.id))
            .eq('categorie', categorie);
        if (predictionsError) throw predictionsError;

        const pseudoByPlayerId = new Map(players.map((player) => [player.id, player.pseudo]));
        return (predictions ?? []).map((prediction) => ({
            joueur_id: prediction.joueur_id,
            pseudo: pseudoByPlayerId.get(prediction.joueur_id) ?? 'Joueur',
            candidate_id: prediction.candidate_id,
        }));
    }

    async ensureSession() {
        const { data } = await this.client.auth.getSession();
        if (!data.session) {
            const { error } = await this.client.auth.signInAnonymously();
            if (error) throw error;
        }
        return (await this.client.auth.getUser()).data.user!;
    }

    async createSalon(pseudo: string) {
        const user = await this.ensureSession();
        const code = Math.random().toString(36).substring(2, 7).toUpperCase();
        const { data: salon, error } = await this.client
            .from('salons')
            .insert({
                nom: `Salon de ${pseudo}`,
                code,
                admin_id: user.id,
                statut: 'ouvert',
            })
            .select()
            .single();
        if (error) throw error;
        const joueur = await this.joinWithSalon(salon.id, pseudo, user.id);
        this.storeSession(salon, joueur);
        return salon;
    }

    async joinSalon(code: string, pseudo: string) {
        const user = await this.ensureSession();
        const { data: salon, error } = await this.client
            .from('salons')
            .select()
            .eq('code', code.toUpperCase())
            .single();
        if (error) throw new Error('Salon introuvable');
        if (salon.statut !== 'ouvert') {
            throw new Error('Ce salon est verrouillé et n’accepte plus de nouveaux joueurs.');
        }
        const joueur = await this.joinWithSalon(salon.id, pseudo, user.id);
        this.storeSession(salon, joueur);
        return salon;
    }

    async reconnectToSalon() {
        const savedSalon = this.salon();
        const savedJoueur = this.joueur();
        if (!savedSalon || !savedJoueur) {
            throw new Error('Aucune partie enregistrée à reprendre.');
        }

        const { data: userData, error: authError } = await this.client.auth.getUser();
        if (authError || !userData.user) {
            throw new Error(
                'Ta session de connexion a expiré. Rejoins à nouveau le salon avec son code.',
            );
        }
        if (userData.user.id !== savedJoueur.user_id) {
            throw new Error(
                'Cette partie appartient à une autre session. Rejoins à nouveau le salon avec son code.',
            );
        }

        const [{ data: salon, error: salonError }, { data: joueur, error: joueurError }] =
            await Promise.all([
                this.client.from('salons').select().eq('id', savedSalon.id).maybeSingle(),
                this.client
                    .from('joueurs')
                    .select()
                    .eq('id', savedJoueur.id)
                    .eq('user_id', userData.user.id)
                    .maybeSingle(),
            ]);

        if (salonError) throw salonError;
        if (joueurError) throw joueurError;
        if (!salon || !joueur) {
            throw new Error('Cette partie n’est plus disponible. Rejoins un salon avec son code.');
        }

        this.storeSession(salon, joueur);
    }

    private async joinWithSalon(salonId: string, pseudo: string, userId: string) {
        const { data, error } = await this.client
            .from('joueurs')
            .insert({ salon_id: salonId, user_id: userId, pseudo })
            .select()
            .single();
        if (error) throw error;
        return data;
    }

    private storeSession(salon: Salon, joueur: Joueur) {
        this.salon.set(salon);
        this.joueur.set(joueur);

        if (isPlatformBrowser(this.platformId)) {
            this.persistSalon(salon);
            localStorage.setItem('joueur', JSON.stringify(joueur));
            sessionStorage.removeItem('salon');
            sessionStorage.removeItem('joueur');
        }
    }

    private updateStoredSalonStatus(statut: Salon['statut']) {
        this.updateStoredSalon({ statut });
    }

    private updateStoredSalon(update: Partial<Pick<Salon, 'statut' | 'etape'>>) {
        const salon = this.salon();
        if (!salon) return;
        const updatedSalon = { ...salon, ...update };
        this.salon.set(updatedSalon);
        this.persistSalon(updatedSalon);
    }

    private persistSalon(salon: Salon) {
        if (isPlatformBrowser(this.platformId)) {
            localStorage.setItem('salon', JSON.stringify(salon));
        }
    }

    private readStoredValue<T>(key: string): T | null {
        if (!isPlatformBrowser(this.platformId)) return null;

        const storedValue = localStorage.getItem(key) ?? sessionStorage.getItem(key);
        if (!storedValue) return null;

        try {
            return JSON.parse(storedValue) as T;
        } catch (error) {
            console.warn(`Les données locales « ${key} » sont illisibles.`, error);
            localStorage.removeItem(key);
            sessionStorage.removeItem(key);
            return null;
        }
    }
}