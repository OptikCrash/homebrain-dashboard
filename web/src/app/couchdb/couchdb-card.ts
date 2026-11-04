import { DatePipe } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, interval, map, of, startWith, switchMap } from 'rxjs';
import { HistoryStrip } from '../shared/history-strip';
import { timelineSegments } from '../shared/timeline';
import { CouchdbResponse, CouchdbStatus } from './couchdb-status';

// Matches the API's default COUCHDB_POLL_INTERVAL_MS: polling faster only
// re-reads the same snapshots.
const DEFAULT_REFRESH_MS = 30_000;

// "LiveSync / CouchDB" card: polls GET /api/status/couchdb and shows whether
// CouchDB is reachable, plus a timeline strip of its recent history.
// Reachability only for v1; the API has no replication detail yet.
@Component({
  selector: 'app-couchdb-card',
  imports: [DatePipe, HistoryStrip],
  template: `
    <section class="card">
      <header>
        <h2>LiveSync / CouchDB</h2>
        @if (updatedAt(); as updated) {
          <span class="updated">Updated {{ updated | date: 'mediumTime' }}</span>
        }
      </header>

      @if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      }

      @if (view(); as v) {
        @if (v.current; as current) {
          <div class="row">
            <span class="name">Server</span>
            <span class="badge" [attr.data-status]="current.status">{{ current.reachability }}</span>
          </div>
          @if (current.error) {
            <p class="problem">Check error: {{ current.error }}</p>
          }
        } @else {
          <p class="empty">No CouchDB status recorded yet.</p>
        }

        @if (v.segments.length) {
          <app-history-strip
            [segments]="v.segments"
            ariaLabel="CouchDB history"
            unhealthyMeaning="Red: CouchDB didn't answer GET /_up."
          />
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
    .updated,
    .empty {
      color: #57606a;
      font-size: 0.85rem;
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
    .row {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .name {
      font-weight: 600;
    }
    .badge {
      border-radius: 999px;
      padding: 0.1rem 0.6rem;
      font-size: 0.8rem;
      color: #fff;
      background: #6e7781;
    }
    .badge[data-status='healthy'] {
      background: #1a7f37;
    }
    .badge[data-status='unhealthy'] {
      background: #cf222e;
    }
  `,
})
export class CouchdbCard implements OnInit {
  readonly refreshMs = input(DEFAULT_REFRESH_MS);

  private readonly couchdb = inject(CouchdbStatus);
  private readonly destroyRef = inject(DestroyRef);
  private readonly response = signal<{ data: CouchdbResponse; at: Date } | null>(null);

  readonly error = signal<string | null>(null);
  readonly updatedAt = computed(() => this.response()?.at ?? null);
  readonly view = computed(() => {
    const response = this.response();
    if (!response) return null;
    const current = response.data.current;
    return {
      current: current && {
        status: current.status,
        // A failed check records no reading, so reachability is unknown.
        reachability: current.reachable === undefined ? 'unknown' : current.reachable ? 'reachable' : 'unreachable',
        error: current.error,
      },
      segments: timelineSegments(response.data.history, response.at),
    };
  });

  ngOnInit(): void {
    interval(this.refreshMs())
      .pipe(
        startWith(0),
        // A refresh that's still waiting is dropped in favour of the next.
        switchMap(() =>
          this.couchdb.get().pipe(
            map((data) => ({ data })),
            catchError(() => of({ data: null })),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(({ data }) => {
        if (data) {
          this.response.set({ data, at: new Date() });
          this.error.set(null);
        } else {
          // Keep showing the last good data alongside the error.
          this.error.set('Could not reach the dashboard API; retrying.');
        }
      });
  }
}
