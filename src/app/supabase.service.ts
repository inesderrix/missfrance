import { Injectable } from '@angular/core';
import { createClient } from '@supabase/supabase-js';
import { environment } from '../environments/environment';

@Injectable({ providedIn: 'root' })
export class SupabaseService {
    client = createClient(environment.supabaseUrl, environment.supabaseKey);

    async getCandidates() {
        const { data, error } = await this.client.from('candidates').select('*');
        if (error) throw error;
        return data;
    }
}