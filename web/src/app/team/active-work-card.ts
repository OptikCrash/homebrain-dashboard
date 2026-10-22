import { DatePipe } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, interval, map, of, startWith, switchMap } from 'rxjs';
import { ACTIVE_PHASES, ActiveWork, TeamStatus, TeamStatusResponse, formatDuration, isActivePhase, workLabel } from './team-status';

// The API reads the status files on each request; this also sets how often
// the elapsed times move.
const DEFAULT_REFRESH_MS = 15_000;

type StepState = 'complete' | 'current' | 'pending';

// "Active work" card: polls GET /api/team/status and shows each teammate's
// latest job with a phase stepper and how long it's been running, plus the
// most recently finished jobs.
@Component({
  selector: 'app-active-work-card',
  imports: [DatePipe],
  template: `
    <section class="card">
      <header>
        <h2>Active work</h2>
        @if (updatedAt(); as updated) {
          <span class="updated">Updated {{ updated | date: 'mediumTime' }}</span>
        }
      </header>

      @if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      }

      @if (view(); as v) {
        @if (v.active.length) {
          <ul class="work" aria-label="Active work">
            @for (row of v.active; track row.instance) {
              <li class="job" [attr.data-phase]="row.phase">
                <div class="row">
                  <span class="name">{{ row.name }}</span>
                  <span class="target">{{ row.label }}</span>
                  <span class="elapsed">{{ row.elapsed }}</span>
                </div>
                @if (row.branch) {
                  <code class="branch">{{ row.branch }}</code>
                }
                @if (row.steps) {
                  <ol class="stepper" [attr.aria-label]="row.name + ' phase'">
                    @for (step of row.steps; track step.phase) {
                      <li class="step" [attr.data-state]="step.state" [attr.aria-current]="step.state === 'current' ? 'step' : null">
                        {{ step.phase }}
                        @if (step.state === 'complete') {
                          <span class="visually-hidden">(done)</span>
                        } @else if (step.state === 'pending') {
                          <span class="visually-hidden">(not reached)</span>
                        }
                      </li>
                    }
                  </ol>
                } @else {
                  <p class="outcome">
                    <span class="badge" [attr.data-phase]="row.phase">{{ row.phase }}</span>
                    @if (row.result) {
                      <span class="result">{{ row.result }}</span>
                    }
                  </p>
                }
              </li>
            }
          </ul>
        } @else {
          <p class="empty">Nobody is working on anything right now.</p>
        }

        <h3>Recent</h3>
        @if (v.recent.length) {
          <ul class="recent" aria-label="Recently finished">
            @for (item of v.recent; track $index) {
              <li class="recent-item">
                <span class="name">{{ item.name }}</span>
                <span class="target">{{ item.label }}</span>
                <span class="result">{{ item.result }}</span>
                <time class="when" [attr.datetime]="item.updated_at">{{ item.when }}</time>
              </li>
            }
          </ul>
        } @else {
          <p class="empty">No finished work yet.</p>
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
      margin: 1rem 0 0.25rem;
      font-size: 0.95rem;
    }
    .updated,
    .empty,
    .elapsed,
    .when,
    .result {
      color: #57606a;
      font-size: 0.85rem;
    }
    .error {
      color: #a40e26;
    }
    .work,
    .recent {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .job {
      padding: 0.6rem 0;
      border-top: 1px solid #eaeef2;
    }
    .row,
    .recent-item {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 0.5rem;
    }
    .recent-item {
      padding: 0.35rem 0;
      border-top: 1px solid #eaeef2;
    }
    .elapsed,
    .when {
      margin-left: auto;
    }
    .name {
      font-weight: 600;
    }
    .target {
      font-size: 0.9rem;
    }
    .branch {
      display: block;
      margin-top: 0.25rem;
      font-size: 0.8rem;
      color: #424a53;
    }
    .stepper {
      display: flex;
      gap: 0.25rem;
      list-style: none;
      margin: 0.5rem 0 0;
      padding: 0;
    }
    .step {
      flex: 1;
      padding: 0.15rem 0.4rem;
      border-radius: 3px;
      text-align: center;
      font-size: 0.8rem;
      background: #f6f8fa;
      color: #6e7781;
    }
    .step[data-state='complete'] {
      background: #dafbe1;
      color: #116329;
    }
    .step[data-state='current'] {
      background: #0969da;
      color: #fff;
      font-weight: 600;
    }
    .outcome {
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
      margin: 0.5rem 0 0;
    }
    .badge {
      border-radius: 999px;
      padding: 0.1rem 0.6rem;
      font-size: 0.8rem;
      color: #fff;
      background: #6e7781;
    }
    .badge[data-phase='done'] {
      background: #1a7f37;
    }
    .badge[data-phase='failed'] {
      background: #cf222e;
    }
    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }
  `,
})
export class ActiveWorkCard implements OnInit {
  readonly refreshMs = input(DEFAULT_REFRESH_MS);

  private readonly team = inject(TeamStatus);
  private readonly destroyRef = inject(DestroyRef);
  private readonly response = signal<{ data: TeamStatusResponse; at: Date } | null>(null);

  readonly error = signal<string | null>(null);
  readonly updatedAt = computed(() => this.response()?.at ?? null);
  readonly view = computed(() => {
    const response = this.response();
    if (!response) return null;
    const now = response.at.getTime();
    return {
      active: response.data.active.map((work) => ({
        instance: work.instance,
        name: work.name,
        label: workLabel(work),
        branch: work.branch,
        phase: work.phase,
        result: work.result,
        // A finished job shows how long it took rather than a running clock.
        elapsed: isActivePhase(work.phase)
          ? `for ${formatDuration(now - Date.parse(work.started_at))}`
          : `took ${formatDuration(Date.parse(work.updated_at) - Date.parse(work.started_at))}`,
        steps: phaseSteps(work),
      })),
      recent: response.data.recent.map((item) => ({
        ...item,
        label: workLabel(item),
        when: `${item.phase} ${formatDuration(now - Date.parse(item.updated_at))} ago`,
      })),
    };
  });

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
          this.response.set({ data, at: new Date() });
          this.error.set(null);
        } else {
          // Keep showing the last good data alongside the error.
          this.error.set('Could not reach the dashboard API; retrying.');
        }
      });
  }
}

// Stepper for a running job; null once it has reached a terminal phase.
function phaseSteps(work: ActiveWork): { phase: string; state: StepState }[] | null {
  if (!isActivePhase(work.phase)) return null;
  const current = ACTIVE_PHASES.indexOf(work.phase);
  return ACTIVE_PHASES.map((phase, i) => ({
    phase,
    state: i < current ? 'complete' : i === current ? 'current' : 'pending',
  }));
}
