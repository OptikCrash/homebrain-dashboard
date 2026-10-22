import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { HealthStatus } from '../syncthing/syncthing-status';

// Shapes returned by the API's GET /api/status/couchdb (see README). v1 is
// reachability only; replication detail needs a read-only CouchDB user.

// A failed check (status 'unknown') carries only `error`, so `reachable` is
// optional.
export interface CouchdbSnapshot {
  status: HealthStatus;
  recordedAt: string;
  reachable?: boolean;
  error?: string;
}

export interface CouchdbResponse {
  current: CouchdbSnapshot | null;
  // Newest first, including `current`.
  history: CouchdbSnapshot[];
}

@Injectable({ providedIn: 'root' })
export class CouchdbStatus {
  private readonly http = inject(HttpClient);

  get(): Observable<CouchdbResponse> {
    return this.http.get<CouchdbResponse>('/api/status/couchdb');
  }
}
