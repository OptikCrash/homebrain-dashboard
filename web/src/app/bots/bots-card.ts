import { DatePipe } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, interval, map, of, startWith, switchMap } from 'rxjs';
import { BotHealth, BotId, BotsResponse, BotsStatus } from './bots-status';

// The host refreshes the status files every minute; polling faster only
// re-reads the same files.
const DEFAULT_REFRESH_MS = 30_000;

const BOT_LABELS: Record<BotId, string> = { chopper: 'Chopper', ap5: 'AP-5' };

// Badge colours: green for good, red for bad, grey for unknown/n/a.
type Tone = 'healthy' | 'unhealthy' | 'unknown';

interface BotView {
  bot: BotId;
  label: string;
  present: boolean;
  stale: boolean;
  checkedAt: string | null;
  container: { text: string; tone: Tone };
  api: { text: string; tone: Tone };
  readiness: { text: string; tone: Tone };
  lastMessageAt: string | null;
  lastReplyAt: string | null;
}

function botView(health: BotHealth): BotView {
  const label = (health.present && health.name) || BOT_LABELS[health.bot] || health.bot;
  if (!health.present) {
    const unknown = { text: 'unknown', tone: 'unknown' as const };
    return {
      bot: health.bot, label, present: false, stale: false, checkedAt: null,
      container: unknown, api: unknown, readiness: unknown, lastMessageAt: null, lastReplyAt: null,
    };
  }
  const container = health.container ?? 'unknown';
  const api = health.api ?? 'unknown';
  // Readiness only means something when /health answered.
  const readiness = health.api === 'up' ? (health.readiness ?? 'unknown') : 'n/a';
  return {
    bot: health.bot,
    label,
    present: true,
    stale: health.stale,
    checkedAt: health.checked_at,
    container: { text: container, tone: container === 'running' ? 'healthy' : health.container ? 'unhealthy' : 'unknown' },
    api: { text: api, tone: api === 'up' ? 'healthy' : api === 'down' ? 'unhealthy' : 'unknown' },
    readiness: {
      text: readiness,
      tone: readiness === 'ok' ? 'healthy' : readiness === 'n/a' || readiness === 'unknown' ? 'unknown' : 'unhealthy',
    },
    lastMessageAt: health.last_message_at,
    lastReplyAt: health.last_reply_at,
  };
}

// "Bot health" card: polls GET /api/status/bots and shows Chopper and AP-5's
// container state, Hermes API and readiness, and last message/reply times
// (UTC, times only — never message contents). Readings the host hasn't
// refreshed in ~3 minutes are flagged "status stale" rather than trusted.
@Component({
  selector: 'app-bots-card',
  imports: [DatePipe],
  template: `
    <section class="card">
      <header>
        <h2>Bot health</h2>
        @if (updatedAt(); as updated) {
          <span class="updated">Updated {{ updated | date: 'mediumTime' }}</span>
        }
      </header>

      @if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      }

      @if (bots(); as bots) {
        @if (bots.length) {
          <ul class="bots" aria-label="Bots">
            @for (b of bots; track b.bot) {
              <li class="bot" [attr.data-bot]="b.bot" [class.stale]="b.stale">
                <div class="title">
                  <h3>{{ b.label }}</h3>
                  @if (b.stale) {
                    <span class="stale-badge">status stale</span>
                  }
                </div>
                @if (b.present) {
                  @if (b.stale) {
                    <p class="problem">
                      @if (b.checkedAt) {
                        Last checked {{ b.checkedAt | date: 'yyyy-MM-dd HH:mm' : 'UTC' }} UTC; this may not be current.
                      } @else {
                        No check time recorded; this may not be current.
                      }
                    </p>
                  }
                  <dl>
                    <div class="field" data-field="container">
                      <dt>Container</dt>
                      <dd><span class="badge" [attr.data-status]="b.container.tone">{{ b.container.text }}</span></dd>
                    </div>
                    <div class="field" data-field="api">
                      <dt>API</dt>
                      <dd><span class="badge" [attr.data-status]="b.api.tone">{{ b.api.text }}</span></dd>
                    </div>
                    <div class="field" data-field="readiness">
                      <dt>Readiness</dt>
                      <dd><span class="badge" [attr.data-status]="b.readiness.tone">{{ b.readiness.text }}</span></dd>
                    </div>
                    <div class="field" data-field="last-message">
                      <dt>Last message</dt>
                      <dd>
                        @if (b.lastMessageAt; as at) {
                          <time [attr.datetime]="at">{{ at | date: 'yyyy-MM-dd HH:mm' : 'UTC' }} UTC</time>
                        } @else {
                          <span class="none">none recorded</span>
                        }
                      </dd>
                    </div>
                    <div class="field" data-field="last-reply">
                      <dt>Last reply</dt>
                      <dd>
                        @if (b.lastReplyAt; as at) {
                          <time [attr.datetime]="at">{{ at | date: 'yyyy-MM-dd HH:mm' : 'UTC' }} UTC</time>
                        } @else {
                          <span class="none">none recorded</span>
                        }
                      </dd>
                    </div>
                  </dl>
                } @else {
                  <p class="empty">No status file for {{ b.label }} yet.</p>
                }
              </li>
            }
          </ul>
        } @else {
          <p class="empty">No bots reported.</p>
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
      margin: 0;
      font-size: 1rem;
    }
    .updated,
    .empty,
    .none {
      color: #57606a;
      font-size: 0.85rem;
    }
    .empty {
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
    .bots {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .bot {
      padding: 0.6rem 0;
      border-top: 1px solid #eaeef2;
    }
    .title {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    dl {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
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
    /* A stale reading is shown, but muted so it doesn't read as current. */
    .bot.stale dl {
      opacity: 0.7;
    }
    .badge,
    .stale-badge {
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
    .stale-badge {
      background: #9a6700;
    }
  `,
})
export class BotsCard implements OnInit {
  readonly refreshMs = input(DEFAULT_REFRESH_MS);

  private readonly status = inject(BotsStatus);
  private readonly destroyRef = inject(DestroyRef);
  private readonly response = signal<BotsResponse | null>(null);

  readonly updatedAt = signal<Date | null>(null);
  readonly error = signal<string | null>(null);
  readonly bots = computed(() => this.response()?.bots.map(botView) ?? null);

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
