import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

// Shapes returned by the API's GET /api/status/backups (see README).

// `skipped` means the USB backup drive was missing.
export type BackupState = 'running' | 'ok' | 'failed' | 'skipped';

// One run as read from backup.json. Missing metrics and timestamps are null;
// timestamps are UTC ISO strings.
export interface BackupRun {
  state: BackupState;
  started_at: string | null;
  finished_at: string | null;
  last_success: string | null;
  error: string | null;
  snapshot_id: string | null;
  files_total: number | null;
  bytes_total: number | null;
  bytes_added: number | null;
  duration_s: number | null;
}

// `previous` (the last completed run) is only set while `state` is 'running'.
// `stale` is true when last_success is more than 26 hours old; no success at
// all is not stale.
export interface CurrentBackup extends BackupRun {
  previous: BackupRun | null;
  stale: boolean;
}

// A completed run from the persisted history; `previous` is always null.
export interface BackupHistoryRun extends BackupRun {
  state: Exclude<BackupState, 'running'>;
  finished_at: string;
  previous: null;
}

export interface BackupsResponse {
  // null before the API's first poll or when backup.json doesn't exist.
  current: CurrentBackup | null;
  // Up to ten completed runs, newest first.
  history: BackupHistoryRun[];
}

@Injectable({ providedIn: 'root' })
export class BackupsStatus {
  private readonly http = inject(HttpClient);

  get(): Observable<BackupsResponse> {
    return this.http.get<BackupsResponse>('/api/status/backups');
  }
}
