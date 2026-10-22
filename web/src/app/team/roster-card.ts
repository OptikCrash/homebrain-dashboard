import { DatePipe } from '@angular/common';
import { Component, DestroyRef, OnInit, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, interval, map, of, startWith, switchMap } from 'rxjs';
import { RosterMember, TeamStatus } from './team-status';

// The API reads the status files on each request, so this only bounds how
// quickly a teammate flips between idle and active.
const DEFAULT_REFRESH_MS = 15_000;

// "Team roster" card: polls GET /api/team/status and shows every teammate,
// their title and whether they're idle or active.
@Component({
  selector: 'app-roster-card',
  imports: [DatePipe],
  template: `
    <section class="card">
      <header>
        <h2>Team roster</h2>
        @if (updatedAt(); as updated) {
          <span class="updated">Updated {{ updated | date: 'mediumTime' }}</span>
        }
      </header>

      @if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      }

      @if (roster(); as members) {
        @if (members.length) {
          <ul class="members" aria-label="Teammates">
            @for (member of members; track member.name) {
              <li class="member">
                <div class="who">
                  <span class="name">{{ member.name }}</span>
                  <span class="title">{{ member.title }}</span>
                </div>
                <span class="badge" [attr.data-status]="member.status">{{ member.status }}</span>
              </li>
            }
          </ul>
        } @else {
          <p class="empty">No teammates on the roster.</p>
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
    .title {
      color: #57606a;
      font-size: 0.85rem;
    }
    .error {
      color: #a40e26;
    }
    .members {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .member {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.5rem 0;
      border-top: 1px solid #eaeef2;
    }
    .who {
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
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
    .badge[data-status='active'] {
      background: #1a7f37;
    }
  `,
})
export class RosterCard implements OnInit {
  readonly refreshMs = input(DEFAULT_REFRESH_MS);

  private readonly team = inject(TeamStatus);
  private readonly destroyRef = inject(DestroyRef);

  readonly roster = signal<RosterMember[] | null>(null);
  readonly updatedAt = signal<Date | null>(null);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    interval(this.refreshMs())
      .pipe(
        startWith(0),
        // A refresh that's still waiting is dropped in favour of the next.
        switchMap(() =>
          this.team.get().pipe(
            map((data) => ({ data })),
            catchError(() => of({ data: null })),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(({ data }) => {
        if (data) {
          this.roster.set(data.roster);
          this.updatedAt.set(new Date());
          this.error.set(null);
        } else {
          // Keep showing the last good data alongside the error.
          this.error.set('Could not reach the dashboard API; retrying.');
        }
      });
  }
}
