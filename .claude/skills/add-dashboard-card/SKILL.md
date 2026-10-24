---
name: add-dashboard-card
description: Use when adding a new status card to the dashboard home page.
---

Use when adding a new status card to the dashboard home page.

## Steps

1. **Create the typed service.** Follow `web/src/app/couchdb/couchdb-status.ts`:
   response interfaces and an `@Injectable({ providedIn: 'root' })` service using
   injected `HttpClient`, with `get(): Observable<ResponseType>` calling
   `http.get<ResponseType>(endpoint)`. Match the API's actual null/optional fields;
   Syncthing's unknown snapshots omit readings, while backup metrics can be null
   (`web/src/app/syncthing/syncthing-status.ts`,
   `web/src/app/backups/backups-status.ts`). HTTP access lives in the service;
   polling currently lives in the card. Don't invent unavailable API data.

2. **Build the standalone card.** Use
   `web/src/app/couchdb/couchdb-card.ts` or
   `web/src/app/syncthing/syncthing-card.ts` as the shape: `@Component` with
   `selector`, `imports` (e.g. `DatePipe`, `HistoryStrip`), inline `template` and
   `styles`; these standalone components omit an explicit `standalone: true`.
   Use injected service/`DestroyRef`, signals for response/error, and computed
   display models. `web/src/app/team/roster-card.ts` instead stores roster and
   update time directly as signals. Keep the `<section class="card">`, header,
   `<h2>`, Updated time, `@if`/`@for` blocks and tracked rows. Existing cards use
   white backgrounds, `#d0d7de` borders, 8px corners, `1rem 1.25rem` padding and
   `max-width: 40rem`; badges pair status text with color. Preserve labeled
   lists, semantic times and `role="alert"` for request errors.

3. **Poll and cover states.** In `ngOnInit`, existing cards use
   `interval(this.refreshMs())`, `startWith(0)`, `switchMap` to service `get()`,
   inner `map`/`catchError(() => of({ data: null }))`, then
   `takeUntilDestroyed(this.destroyRef)`. `refreshMs` is an input: 30,000ms for
   service-health cards; 15,000ms for team cards, including
   `web/src/app/team/active-work-card.ts`. A new tick cancels a pending request.
   On success, save data and receipt time and clear the error. On failure, set
   “Could not reach the dashboard API; retrying.” without clearing last-good
   data/time. Show Loading only before data and while there is no error; an
   initial failure shows the error alone. Distinguish successful empty responses:
   no recorded status, empty roster, nobody working, missing bot status file,
   or “No backup yet.” `web/src/app/backups/backups-card.ts` preserves recent
   runs when current is null. Where supplied, display API `stale` flags:
   backups show overdue for last success over 26 hours; bots show “status stale”
   and mute readings for missing/over-three-minute check times
   (`web/src/app/bots/bots-card.ts`, `web/src/app/bots/bots-status.ts`).

4. **Reuse history when applicable.** Syncthing and CouchDB call
   `timelineSegments(history, response.at)` from `web/src/app/shared/timeline.ts`
   and render `HistoryStrip` from `web/src/app/shared/history-strip.ts` only for
   nonempty segments. Pass `segments`, `ariaLabel`, and service-specific
   `unhealthyMeaning`. The helper clips to a default 24-hour window; the shared
   component labels actual coverage, supplies status/time hover titles and the
   legend. Don't duplicate the strip. Backups use a recent-run list; bots and
   team cards have no uptime strip.

5. **Write the spec and register.** Follow
   `web/src/app/couchdb/couchdb-card.spec.ts`: TestBed imports the card, provides
   `provideHttpClient()` then `provideHttpClientTesting()`, uses
   `HttpTestingController`, fake timers and a 1,000ms `refreshMs` input.
   Flush typed fixtures and detect changes; assert loading, empty, rendered
   data/status text, interval updates, retained data on 503 and error clearing
   after recovery. `web/src/app/backups/backups-card.spec.ts` and
   `web/src/app/bots/bots-card.spec.ts` also assert initial failure and stale
   states. Strip specs assert segment status/width, accessible label, clipping,
   coverage label and red meaning. Destroy fixtures, verify HTTP requests and
   restore timers. Add the card to the imports array and template in
   `web/src/app/home/home.ts`; extend `web/src/app/home/home.spec.ts`'s rendered
   card-heading assertions. Run `npm test` in `web/`.

## Checklist

- [ ] Typed service created; API fields checked.
- [ ] Loading, empty, error/recovery and relevant stale states covered.
- [ ] Shared strip reused if applicable.
- [ ] Spec written and web tests passed.
- [ ] Card registered on home and home spec updated.
