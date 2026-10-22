import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BuilderSnapshot, BuildersResponse } from './builder-status';
import { BuildersCard } from './builders-card';

const URL = '/api/status/builders';

function snapshot(overrides: Partial<BuilderSnapshot> = {}): BuilderSnapshot {
  return {
    name: 'codex',
    status: 'healthy',
    state: 'idle',
    available: true,
    jobs: [],
    recordedAt: new Date(Date.now() - 60_000).toISOString(),
    ...overrides,
  };
}

function response(...snapshots: BuilderSnapshot[]): BuildersResponse {
  return {
    builders: snapshots.map((current) => ({ name: current.name, current, history: [current] })),
  };
}

describe('BuildersCard', () => {
  let fixture: ComponentFixture<BuildersCard>;
  let http: HttpTestingController;
  let element: HTMLElement;

  beforeEach(async () => {
    vi.useFakeTimers();
    await TestBed.configureTestingModule({
      imports: [BuildersCard],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(BuildersCard);
    fixture.componentRef.setInput('refreshMs', 1000);
    element = fixture.nativeElement;
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    http.verify();
    vi.useRealTimers();
  });

  it('shows each builder with its state, running job and last log line', () => {
    http.expectOne(URL).flush(
      response(
        snapshot({ name: 'claude' }),
        snapshot({
          name: 'codex',
          state: 'running',
          jobs: [
            {
              name: 'issue-6-codex',
              target: { kind: 'issue', number: 6, builder: 'codex' },
              state: 'running',
              lastLogLine: 'Running tests…',
              stale: false,
            },
          ],
        }),
      ),
    );
    fixture.detectChanges();

    const builders = element.querySelectorAll('.builder');
    expect(builders).toHaveLength(2);
    expect(builders[0].querySelector('.name')?.textContent).toBe('claude');
    expect(builders[0].querySelector('.badge')?.textContent).toBe('idle');
    expect(builders[0].querySelector('.log')).toBeNull();
    expect(builders[1].querySelector('.badge')?.textContent).toBe('running');
    expect(builders[1].querySelector('.target')?.textContent).toBe('issue #6');
    expect(builders[1].querySelector('.log')?.textContent).toBe('Running tests…');
  });

  it('renders a timeline strip from the history', () => {
    const now = Date.now();
    http.expectOne(URL).flush({
      builders: [
        {
          name: 'codex',
          current: snapshot({ recordedAt: new Date(now - 10_000).toISOString() }),
          history: [
            snapshot({ recordedAt: new Date(now - 10_000).toISOString() }),
            snapshot({ status: 'unhealthy', recordedAt: new Date(now - 20_000).toISOString() }),
          ],
        },
      ],
    } satisfies BuildersResponse);
    fixture.detectChanges();

    const segments = element.querySelectorAll<HTMLElement>('.strip .segment');
    expect(Array.from(segments, (s) => s.dataset['status'])).toEqual(['unhealthy', 'healthy']);
    expect(segments[0].style.width).toBe('50%');
  });

  it('refreshes on the interval and reflects the new state', () => {
    http.expectOne(URL).flush(response(snapshot()));
    fixture.detectChanges();
    expect(element.querySelector('.badge')?.textContent).toBe('idle');

    vi.advanceTimersByTime(1000);
    http.expectOne(URL).flush(response(snapshot({ state: 'running' })));
    fixture.detectChanges();
    expect(element.querySelector('.badge')?.textContent).toBe('running');
  });

  it('keeps the last data and shows an error when a refresh fails', () => {
    http.expectOne(URL).flush(response(snapshot()));
    vi.advanceTimersByTime(1000);
    http.expectOne(URL).flush({ error: 'Builder status unavailable' }, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();

    expect(element.querySelector('.error')?.textContent).toContain('retrying');
    expect(element.querySelectorAll('.builder')).toHaveLength(1);

    vi.advanceTimersByTime(1000);
    http.expectOne(URL).flush(response(snapshot()));
    fixture.detectChanges();
    expect(element.querySelector('.error')).toBeNull();
  });

  it('says so when no builders have been seen', () => {
    http.expectOne(URL).flush({ builders: [] });
    fixture.detectChanges();
    expect(element.querySelector('.empty')?.textContent).toContain('No builders');
  });
});
