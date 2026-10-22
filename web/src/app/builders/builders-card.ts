import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, DestroyRef, OnInit, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, interval, map, of, startWith, switchMap } from 'rxjs';
import { BuilderJob, BuildersResponse } from './builder-status';
import { timelineSegments } from '../shared/timeline';

// Matches the API's default BUILDER_POLL_INTERVAL_MS: polling faster only
// re-reads the same snapshots.
const DEFAULT_REFRESH_MS = 30_000;

// "Dev Builders" card: polls GET /api/status/builders and shows each builder's
// current state plus a timeline strip of its recent history.
@Component({
  selector: 'app-builders-card',
  imports: [DatePipe],
  template: `
    <section class="card">
      <header>
        <h2>Dev Builders</h2>
        @if (updatedAt(); as updated) {
          <span class="updated">Updated {{ updated | date: 'mediumTime' }}</span>
        }
      </header>

      @if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      }

      @if (builders(); as list) {
        @for (builder of list; track builder.name) {
          <article class="builder">
            <div class="row">
              <span class="name">{{ builder.name }}</span>
              <span class="badge" [attr.data-status]="builder.status">{{ builder.state }}</span>
            </div>

            @for (job of builder.running; track job.name) {
              <div class="job">
                <span class="target">{{ jobLabel(job) }}</span>
                @if (job.stale) {
                  <span class="stale">stale</span>
                }
                @if (job.lastLogLine) {
                  <code class="log">{{ job.lastLogLine }}</code>
                }
              </div>
            }
            @if (builder.error) {
              <div class="job">Logs unavailable: {{ builder.error }}</div>
            }

            <div class="strip" role="img" [attr.aria-label]="builder.name + ' history'">
              @for (segment of builder.segments; track segment.start.getTime()) {
                <span
                  class="segment"
                  [attr.data-status]="segment.status"
                  [style.width.%]="segment.percent"
                  [title]="segment.status + ': ' + (segment.start | date: 'short') + ' – ' + (segment.end | date: 'short')"
                ></span>
              }
            </div>
          </article>
        } @empty {
          <p class="empty">No builders seen yet.</p>
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
    .error {
      color: #a40e26;
    }
    .builder {
      padding: 0.6rem 0;
      border-top: 1px solid #eaeef2;
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
    .job {
      margin-top: 0.35rem;
      font-size: 0.85rem;
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      align-items: baseline;
    }
    .stale {
      color: #cf222e;
      font-weight: 600;
    }
    .log {
      flex-basis: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: #424a53;
    }
    .strip {
      display: flex;
      height: 0.6rem;
      margin-top: 0.5rem;
      border-radius: 3px;
      overflow: hidden;
      background: #eaeef2;
    }
    .segment {
      background: #8c959f;
    }
    .segment[data-status='healthy'] {
      background: #2da44e;
    }
    .segment[data-status='unhealthy'] {
      background: #cf222e;
    }
  `,
})
export class BuildersCard implements OnInit {
  readonly refreshMs = input(DEFAULT_REFRESH_MS);

  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly response = signal<{ data: BuildersResponse; at: Date } | null>(null);

  readonly error = signal<string | null>(null);
  readonly updatedAt = computed(() => this.response()?.at ?? null);
  readonly builders = computed(() => {
    const response = this.response();
    if (!response) return null;
    return response.data.builders.map((builder) => ({
      name: builder.name,
      status: builder.current?.status ?? 'unknown',
      state: builder.current?.state ?? 'unknown',
      error: builder.current?.error,
      running: (builder.current?.jobs ?? []).filter((job) => job.state === 'running'),
      segments: timelineSegments(builder.history, response.at),
    }));
  });

  ngOnInit(): void {
    interval(this.refreshMs())
      .pipe(
        startWith(0),
        // A refresh that's still waiting is dropped in favour of the next.
        switchMap(() =>
          this.http.get<BuildersResponse>('/api/status/builders').pipe(
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

  jobLabel(job: BuilderJob): string {
    if (job.target?.kind === 'issue') return `issue #${job.target.number}`;
    if (job.target?.kind === 'pr') return `review of PR #${job.target.number}`;
    return job.name;
  }
}
