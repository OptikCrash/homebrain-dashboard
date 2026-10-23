import { DatePipe } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, interval, map, of, startWith, switchMap } from 'rxjs';
import { formatBytes } from '../shared/format-bytes';
import { BackupRun, BackupState, BackupsResponse, BackupsStatus, CurrentBackup } from './backups-status';

// Matches the API's default BACKUP_POLL_INTERVAL_MS: polling faster only
// re-reads the same reading.
const DEFAULT_REFRESH_MS = 30_000;

// Badge colours: green ok, red failed, amber skipped, blue running.
type Tone = 'healthy' | 'unhealthy' | 'warning' | 'running';

const TONES: Record<BackupState, Tone> = { ok: 'healthy', failed: 'unhealthy', skipped: 'warning', running: 'running' };

interface RunSummary {
  state: BackupState;
  tone: Tone;
  finishedAt: string | null;
  bytesAdded: string | null;
}

function runSummary(run: BackupRun): RunSummary {
  return {
    state: run.state,
    tone: TONES[run.state],
    finishedAt: run.finished_at,
    bytesAdded: run.bytes_added == null ? null : formatBytes(run.bytes_added),
  };
}

function currentView(current: CurrentBackup) {
  return {
    ...runSummary(current),
    startedAt: current.started_at,
    lastSuccess: current.last_success,
    stale: current.stale,
    error: current.error,
    snapshotId: current.snapshot_id,
    filesTotal: current.files_total,
    duration: current.duration_s == null ? null : formatDuration(current.duration_s),
    previous: current.previous && runSummary(current.previous),
  };
}

// "Backups" card: polls GET /api/status/backups and shows the nightly restic
// run's current state (a progress indicator while running, alongside the
// previous run's outcome), flags a last success older than ~26 hours, and
// lists recent completed runs.
@Component({
  selector: 'app-backups-card',
  imports: [DatePipe],
  template: `
    <section class="card">
      <header>
        <h2>Backups</h2>
        @if (updatedAt(); as updated) {
          <span class="updated">Updated {{ updated | date: 'mediumTime' }}</span>
        }
      </header>

      @if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      }

      @if (view(); as v) {
        @if (v.current; as c) {
          <div class="current" [class.stale]="c.stale">
            <div class="row">
              <span class="name">Nightly backup</span>
              <span class="badge" data-field="state" [attr.data-status]="c.tone">{{ c.state }}</span>
            </div>

            @switch (c.state) {
              @case ('running') {
                <progress class="progress" aria-label="Backup in progress"></progress>
                <p class="detail" data-field="started">
                  @if (c.startedAt; as at) {
                    Started <time [attr.datetime]="at">{{ at | date: 'yyyy-MM-dd HH:mm' : 'UTC' }} UTC</time>
                  } @else {
                    In progress
                  }
                </p>
                <p class="detail" data-field="previous">
                  @if (c.previous; as p) {
                    Last run:
                    <span class="badge small" [attr.data-status]="p.tone">{{ p.state }}</span>
                    @if (p.bytesAdded) {
                      {{ p.bytesAdded }} added
                    }
                    @if (p.finishedAt; as at) {
                      {{ p.bytesAdded ? '·' : '' }} finished <time [attr.datetime]="at">{{ at | date: 'yyyy-MM-dd HH:mm' : 'UTC' }} UTC</time>
                    }
                  } @else {
                    No previous run recorded.
                  }
                </p>
              }
              @case ('failed') {
                <p class="problem" data-field="failure">Backup failed{{ c.error ? ': ' + c.error : '.' }}</p>
              }
              @case ('skipped') {
                <p class="problem warn" data-field="failure">Skipped: the USB backup drive wasn't connected.</p>
              }
            }

            @if (c.state !== 'running') {
              <dl>
                <div class="field" data-field="finished">
                  <dt>Finished</dt>
                  <dd>
                    @if (c.finishedAt; as at) {
                      <time [attr.datetime]="at">{{ at | date: 'yyyy-MM-dd HH:mm' : 'UTC' }} UTC</time>
                    } @else {
                      <span class="none">unknown</span>
                    }
                  </dd>
                </div>
                @if (c.bytesAdded) {
                  <div class="field" data-field="added">
                    <dt>Added</dt>
                    <dd>{{ c.bytesAdded }}</dd>
                  </div>
                }
                @if (c.filesTotal != null) {
                  <div class="field" data-field="files">
                    <dt>Files</dt>
                    <dd>{{ c.filesTotal }}</dd>
                  </div>
                }
                @if (c.duration) {
                  <div class="field" data-field="duration">
                    <dt>Duration</dt>
                    <dd>{{ c.duration }}</dd>
                  </div>
                }
                @if (c.snapshotId) {
                  <div class="field" data-field="snapshot">
                    <dt>Snapshot</dt>
                    <dd class="mono">{{ c.snapshotId }}</dd>
                  </div>
                }
              </dl>
            }

            <p class="detail" data-field="last-success">
              Last success:
              @if (c.lastSuccess; as at) {
                <time [attr.datetime]="at">{{ at | date: 'yyyy-MM-dd HH:mm' : 'UTC' }} UTC</time>
              } @else {
                <span class="none">none recorded</span>
              }
              @if (c.stale) {
                &ngsp;<span class="stale-badge">overdue</span>
              }
            </p>
            @if (c.stale) {
              <p class="problem warn" data-field="stale">No successful backup in over 26 hours — a nightly run was missed.</p>
            }
          </div>
        } @else if (v.history.length) {
          <p class="empty">No backup status file right now.</p>
        } @else {
          <p class="empty">No backup yet.</p>
        }

        @if (v.history.length) {
          <h3>Recent runs</h3>
          <ol class="history" aria-label="Recent runs">
            @for (run of v.history; track run.finishedAt) {
              <li class="run">
                <span class="badge small" [attr.data-status]="run.tone">{{ run.state }}</span>
                <time [attr.datetime]="run.finishedAt">{{ run.finishedAt | date: 'yyyy-MM-dd HH:mm' : 'UTC' }} UTC</time>
                <span class="added">{{ run.bytesAdded ? run.bytesAdded + ' added' : '—' }}</span>
              </li>
            }
          </ol>
        }
      } @else if (!error()) {
        <p class="empty">Loading…</p>
      }
    </section>
  `,
  styles: `
    .card {
      background: #fff;
      border: 1px solid #d0d7de;
      border-radius: 8px;
      padding: 1rem 1.25rem;
      max-width: 40rem;
    }
    header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 1rem;
    }
    h2 {
      margin: 0 0 0.75rem;
      font-size: 1.15rem;
    }
    h3 {
      margin: 0.9rem 0 0.25rem;
      font-size: 0.95rem;
    }
    .updated,
    .empty,
    .none,
    .detail,
    .added {
      color: #57606a;
      font-size: 0.85rem;
    }
    .detail {
      margin: 0.35rem 0 0;
    }
    .error,
    .problem {
      color: #a40e26;
    }
    .problem {
      margin: 0.35rem 0 0;
      font-size: 0.85rem;
      font-weight: 600;
    }
    .problem.warn {
      color: #7d4e00;
    }
    /* A missed night gets an amber rule down the side, not just a badge. */
    .current.stale {
      border-left: 4px solid #9a6700;
      padding-left: 0.6rem;
    }
    .row {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .name {
      font-weight: 600;
    }
    .progress {
      display: block;
      width: 100%;
      margin: 0.5rem 0 0;
      accent-color: #0969da;
    }
    dl {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(8rem, 1fr));
      gap: 0.4rem 1rem;
      margin: 0.5rem 0 0;
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
    }
    dt {
      color: #57606a;
      font-size: 0.8rem;
    }
    dd {
      margin: 0;
      font-size: 0.9rem;
    }
    .mono {
      font-family: ui-monospace, monospace;
    }
    .badge,
    .stale-badge {
      border-radius: 999px;
      padding: 0.1rem 0.6rem;
      font-size: 0.8rem;
      color: #fff;
      background: #6e7781;
    }
    .badge.small {
      font-size: 0.75rem;
      padding: 0.05rem 0.5rem;
    }
    .badge[data-status='healthy'] {
      background: #1a7f37;
    }
    .badge[data-status='unhealthy'] {
      background: #cf222e;
    }
    .badge[data-status='warning'],
    .stale-badge {
      background: #9a6700;
    }
    .badge[data-status='running'] {
      background: #0969da;
    }
    .history {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .run {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.35rem 0;
      border-top: 1px solid #eaeef2;
      font-size: 0.85rem;
    }
    .run .added {
      margin-left: auto;
    }
  `,
})
export class BackupsCard implements OnInit {
  readonly refreshMs = input(DEFAULT_REFRESH_MS);

  private readonly status = inject(BackupsStatus);
  private readonly destroyRef = inject(DestroyRef);
  private readonly response = signal<BackupsResponse | null>(null);

  readonly updatedAt = signal<Date | null>(null);
  readonly error = signal<string | null>(null);
  readonly view = computed(() => {
    const response = this.response();
    if (!response) return null;
    return {
      current: response.current && currentView(response.current),
      history: response.history.map((run) => ({ ...runSummary(run), finishedAt: run.finished_at })),
    };
  });

  ngOnInit(): void {
    interval(this.refreshMs())
      .pipe(
        startWith(0),
        // A refresh that's still waiting is dropped in favour of the next.
        switchMap(() =>
          this.status.get().pipe(
            map((data) => ({ data })),
            catchError(() => of({ data: null })),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(({ data }) => {
        if (data) {
          this.response.set(data);
          this.updatedAt.set(new Date());
          this.error.set(null);
        } else {
          // Keep showing the last good data alongside the error.
          this.error.set('Could not reach the dashboard API; retrying.');
        }
      });
  }
}

// e.g. 252 -> "4m 12s", 3725 -> "1h 2m".
function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}
