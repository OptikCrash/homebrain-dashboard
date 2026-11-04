import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

// Shapes returned by the API's GET /api/status/bots (see README). Live state
// only: the API re-reads chopper.json/ap5.json on every request.

export type BotId = 'chopper' | 'ap5';

// The status file is missing or couldn't be parsed.
export interface MissingBotHealth {
  bot: BotId;
  present: false;
}

// Unexpected values in the file arrive as null. `readiness` is always null
// unless `api` is 'up'. Timestamps are UTC ISO strings; message contents are
// never sent.
export interface PresentBotHealth {
  bot: BotId;
  present: true;
  name: string | null;
  checked_at: string | null;
  container: 'running' | 'restarting' | 'exited' | 'missing' | null;
  container_started_at: string | null;
  api: 'up' | 'down' | null;
  readiness: string | null;
  last_message_at: string | null;
  last_reply_at: string | null;
  // checked_at is missing or more than three minutes old.
  stale: boolean;
}

export type BotHealth = MissingBotHealth | PresentBotHealth;

export interface BotsResponse {
  // Chopper, then AP-5.
  bots: BotHealth[];
}

@Injectable({ providedIn: 'root' })
export class BotsStatus {
  private readonly http = inject(HttpClient);

  get(): Observable<BotsResponse> {
    return this.http.get<BotsResponse>('/api/status/bots');
  }
}
