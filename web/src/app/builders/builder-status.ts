// Shapes returned by the API's GET /api/status/builders (see README).

export type HealthStatus = 'healthy' | 'unhealthy' | 'unknown';

export interface JobTarget {
  kind: 'issue' | 'pr';
  number: number;
  builder?: string;
}

export interface BuilderJob {
  name: string;
  target: JobTarget | null;
  state: 'idle' | 'running';
  lastLogLine?: string | null;
  lastActivityAt?: string;
  stale?: boolean;
}

export interface BuilderSnapshot {
  name: string;
  status: HealthStatus;
  state: 'idle' | 'running' | 'unknown';
  available: boolean;
  jobs: BuilderJob[];
  error?: string;
  recordedAt: string;
}

export interface BuilderStatus {
  name: string;
  current: BuilderSnapshot | null;
  // Newest first.
  history: BuilderSnapshot[];
}

export interface BuildersResponse {
  builders: BuilderStatus[];
}
