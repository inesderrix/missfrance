import { Component, inject, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';

@Component({
  selector: 'app-root',
  template: `
    <h1>Candidates</h1>
    @for (c of candidates(); track c.id) {
      <p>{{ c.nom }} - {{ c.region }}</p>
    }
  `,
})
export class App {
  private supabase = inject(SupabaseService);
  candidates = signal<any[]>([]);

  async ngOnInit() {
    this.candidates.set(await this.supabase.getCandidates());
  }
}