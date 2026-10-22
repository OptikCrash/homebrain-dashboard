import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

// Shapes returned by the API's GET /api/status/syncthing (see README).

export type HealthStatus = 'healthy' | 'unhealthy' | 'unknown';

export interface SyncthingFolder {
  id: string;
  state: string;
  errors: number;
  needItems: number;
  needBytes: number;
}

// A failed check (status 'unknown') carries only `error`, so the reading's
// fields are optional.
export interface SyncthingSnapshot {
  status: HealthStatus;
  recordedAt: string;
  reachable?: boolean;
  folders?: SyncthingFolder[];
  // Device ID -> connection state.
  connections?: Record<string, { connected: boolean }>;
  error?: string;
}

export interface SyncthingResponse {
  current: SyncthingSnapshot | null;
  // Newest first, including `current`.
  history: SyncthingSnapshot[];
}

@Injectable({ providedIn: 'root' })
export class SyncthingStatus {
  private readonly http = inject(HttpClient);

  get(): Observable<SyncthingResponse> {
    return this.http.get<SyncthingResponse>('/api/status/syncthing');
  }
}
