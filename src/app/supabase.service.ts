import { isPlatformBrowser } from '@angular/common';
import { inject, Injectable, PLATFORM_ID, signal } from '@angular/core';
import { createClient } from '@supabase/supabase-js';
import { environment } from '../environments/environment';

export interface Salon {
    id: string;
    code: string;
    nom: string;
}

export interface Joueur {
    id: string;
    salon_id: string;
    user_id: string;
    pseudo: string;
}

@Injectable({ providedIn: 'root' })
export class SupabaseService {
    client = createClient(environment.supabaseUrl, environment.supabaseKey);
    private readonly platformId = inject(PLATFORM_ID);
    readonly salon = signal<Salon | null>(this.readStoredValue<Salon>('salon'));
    readonly joueur = signal<Joueur | null>(this.readStoredValue<Joueur>('joueur'));

    async getCandidates() {
        const { data, error } = await this.client.from('candidates').select('*');
        if (error) throw error;
        return data;
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
            .insert({ nom: `Salon de ${pseudo}`, code, admin_id: user.id })
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
        const joueur = await this.joinWithSalon(salon.id, pseudo, user.id);
        this.storeSession(salon, joueur);
        return salon;
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
            sessionStorage.setItem('salon', JSON.stringify(salon));
            sessionStorage.setItem('joueur', JSON.stringify(joueur));
        }
    }

    private readStoredValue<T>(key: string): T | null {
        if (!isPlatformBrowser(this.platformId)) return null;

        const storedValue = sessionStorage.getItem(key);
        return storedValue ? JSON.parse(storedValue) as T : null;
    }
}