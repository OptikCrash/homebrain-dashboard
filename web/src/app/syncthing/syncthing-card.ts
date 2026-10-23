import { DatePipe } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, interval, map, of, startWith, switchMap } from 'rxjs';
import { formatBytes } from '../shared/format-bytes';
import { HistoryStrip } from '../shared/history-strip';
import { timelineSegments } from '../shared/timeline';
import { SyncthingFolder, SyncthingResponse, SyncthingStatus } from './syncthing-status';

// Matches the API's default SYNCTHING_POLL_INTERVAL_MS: polling faster only
// re-reads the same snapshots.
const DEFAULT_REFRESH_MS = 30_000;

// "Syncthing" card: polls GET /api/status/syncthing and shows whether Syncthing
// is reachable, each folder's sync state and any errors, plus a timeline strip
// of its recent history.
@Component({
  selector: 'app-syncthing-card',
  imports: [DatePipe, HistoryStrip],
  template: `
    <section class="card">
      <header>
        <h2>Syncthing</h2>
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
          @if (current.devices; as devices) {
            <p class="devices">{{ devices.connected }} of {{ devices.total }} devices connected</p>
          }
          @if (current.error) {
            <p class="problem">Check error: {{ current.error }}</p>
          }

          @if (current.folders.length) {
            <ul class="folders" aria-label="Folders">
              @for (folder of current.folders; track folder.id) {
                <li class="folder">
                  <div class="row">
                    <span class="folder-id">{{ folder.id }}</span>
                    <span class="badge" [attr.data-status]="folder.status">{{ folder.state }}</span>
                  </div>
                  @for (problem of folder.problems; track problem) {
                    <p class="problem">{{ problem }}</p>
                  }
                </li>
              }
            </ul>
          } @else if (current.reachable) {
            <p class="empty">No folders reported.</p>
          }
        } @else {
          <p class="empty">No Syncthing status recorded yet.</p>
        }

        @if (v.segments.length) {
          <app-history-strip
            [segments]="v.segments"
            ariaLabel="Syncthing history"
            unhealthyMeaning="Red: Syncthing unreachable, or a folder with errors or out of sync."
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
    .empty,
    .devices {
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
    .devices {
      margin: 0.35rem 0 0;
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
    .folders {
      list-style: none;
      margin: 0.6rem 0 0;
      padding: 0;
    }
    .folder {
      padding: 0.5rem 0;
      border-top: 1px solid #eaeef2;
    }
    .folder-id {
      font-family: ui-monospace, monospace;
      font-size: 0.9rem;
    }
  `,
})
export class SyncthingCard implements OnInit {
  readonly refreshMs = input(DEFAULT_REFRESH_MS);

  private readonly syncthing = inject(SyncthingStatus);
  private readonly destroyRef = inject(DestroyRef);
  private readonly response = signal<{ data: SyncthingResponse; at: Date } | null>(null);

  readonly error = signal<string | null>(null);
  readonly updatedAt = computed(() => this.response()?.at ?? null);
  readonly view = computed(() => {
    const response = this.response();
    if (!response) return null;
    const current = response.data.current;
    const connections = Object.values(current?.connections ?? {});
    return {
      current: current && {
        status: current.status,
        reachable: current.reachable === true,
        // A failed check records no reading, so reachability is unknown.
        reachability: current.reachable === undefined ? 'unknown' : current.reachable ? 'reachable' : 'unreachable',
        devices: current.connections
          ? { connected: connections.filter((c) => c.connected).length, total: connections.length }
          : null,
        error: current.error,
        folders: (current.folders ?? []).map((folder) => {
          const problems = folderProblems(folder);
          return { id: folder.id, state: folder.state, status: problems.length ? 'unhealthy' : 'healthy', problems };
        }),
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
          this.syncthing.get().pipe(
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

// Visible reasons a folder counts against health, mirroring the API's rule.
function folderProblems(folder: SyncthingFolder): string[] {
  const problems: string[] = [];
  if (folder.errors > 0) problems.push(`${folder.errors} ${folder.errors === 1 ? 'error' : 'errors'}`);
  if (folder.needItems > 0 || folder.needBytes > 0) {
    problems.push(`Out of sync: ${folder.needItems} ${folder.needItems === 1 ? 'item' : 'items'} (${formatBytes(folder.needBytes)})`);
  }
  if (folder.state === 'error' && folder.errors === 0) problems.push('Folder is in an error state');
  return problems;
}
