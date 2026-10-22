import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

// Shapes returned by the API's GET /api/team/status (see README).

export type ActivePhase = 'starting' | 'building' | 'pushing' | 'reviewing';
export type TerminalPhase = 'done' | 'failed' | 'no-changes' | 'stopped';
export type Phase = ActivePhase | TerminalPhase;

// In stepper order.
export const ACTIVE_PHASES: readonly ActivePhase[] = ['starting', 'building', 'pushing', 'reviewing'];

export interface RosterMember {
  name: string;
  title: string;
  engine: string;
  summary?: string;
  status: 'idle' | 'active';
}

// The latest instance per teammate; a terminal one stays until replaced.
export interface ActiveWork {
  instance: string;
  name: string;
  title: string;
  engine: string;
  kind: 'build' | 'review';
  issue: number | null;
  pr: number | null;
  branch: string;
  phase: Phase;
  started_at: string;
  updated_at: string;
  result: string;
}

export interface RecentWork {
  name: string;
  title: string;
  issue: number | null;
  pr: number | null;
  phase: TerminalPhase;
  result: string;
  updated_at: string;
}

export interface TeamStatusResponse {
  roster: RosterMember[];
  // Sorted by name.
  active: ActiveWork[];
  // Newest first, at most five.
  recent: RecentWork[];
}

@Injectable({ providedIn: 'root' })
export class TeamStatus {
  private readonly http = inject(HttpClient);

  get(): Observable<TeamStatusResponse> {
    return this.http.get<TeamStatusResponse>('/api/team/status');
  }
}

export function isActivePhase(phase: Phase): phase is ActivePhase {
  return (ACTIVE_PHASES as readonly string[]).includes(phase);
}

// What a job is for, e.g. "issue #6 · PR #13" or "review of PR #13".
export function workLabel(work: Pick<ActiveWork, 'issue' | 'pr'> & { kind?: ActiveWork['kind'] }): string {
  if (work.kind === 'review' && work.pr !== null) return `review of PR #${work.pr}`;
  const parts = [];
  if (work.issue !== null) parts.push(`issue #${work.issue}`);
  if (work.pr !== null) parts.push(`PR #${work.pr}`);
  return parts.join(' · ') || 'no issue or PR';
}

// Compact duration, e.g. "45s", "12m", "1h 5m", "2d 3h".
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days}d ${hours % 24}h` : `${days}d`;
}
