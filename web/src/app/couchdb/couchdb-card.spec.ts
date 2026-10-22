import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CouchdbCard } from './couchdb-card';
import { CouchdbResponse, CouchdbSnapshot } from './couchdb-status';

const URL = '/api/status/couchdb';

function snapshot(overrides: Partial<CouchdbSnapshot> = {}): CouchdbSnapshot {
  return {
    status: 'healthy',
    reachable: true,
    recordedAt: new Date(Date.now() - 60_000).toISOString(),
    ...overrides,
  };
}

function response(current: CouchdbSnapshot): CouchdbResponse {
  return { current, history: [current] };
}

describe('CouchdbCard', () => {
  let fixture: ComponentFixture<CouchdbCard>;
  let http: HttpTestingController;
  let element: HTMLElement;

  beforeEach(async () => {
    vi.useFakeTimers();
    await TestBed.configureTestingModule({
      imports: [CouchdbCard],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(CouchdbCard);
    fixture.componentRef.setInput('refreshMs', 1000);
    element = fixture.nativeElement;
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    http.verify();
    vi.useRealTimers();
  });

  it('shows a loading state before the first response', () => {
    expect(element.querySelector('h2')?.textContent).toContain('LiveSync / CouchDB');
    expect(element.querySelector('.empty')?.textContent).toContain('Loading');
    http.expectOne(URL).flush(response(snapshot()));
  });

  it('shows a healthy, reachable CouchDB', () => {
    http.expectOne(URL).flush(response(snapshot()));
    fixture.detectChanges();

    const badge = element.querySelector<HTMLElement>('.badge');
    expect(badge?.textContent).toBe('reachable');
    expect(badge?.dataset['status']).toBe('healthy');
    expect(element.querySelector('.problem')).toBeNull();
    expect(element.querySelector('.error')).toBeNull();
  });

  it('shows an unhealthy reading with its check error', () => {
    http.expectOne(URL).flush(
      response(snapshot({ status: 'unhealthy', reachable: true, error: 'CouchDB /_up request returned an unexpected status' })),
    );
    fixture.detectChanges();

    expect(element.querySelector<HTMLElement>('.badge')?.dataset['status']).toBe('unhealthy');
    expect(element.querySelector('.problem')?.textContent).toContain('Check error: CouchDB /_up request returned');
  });

  it('shows CouchDB as unreachable with the check error', () => {
    http.expectOne(URL).flush(
      response(snapshot({ status: 'unhealthy', reachable: false, error: 'CouchDB /_up request failed' })),
    );
    fixture.detectChanges();

    const badge = element.querySelector<HTMLElement>('.badge');
    expect(badge?.textContent).toBe('unreachable');
    expect(badge?.dataset['status']).toBe('unhealthy');
    expect(element.querySelector('.problem')?.textContent).toContain('/_up request failed');
    expect(element.querySelector('.empty')).toBeNull();
  });

  it('shows unknown reachability when the check itself failed', () => {
    http.expectOne(URL).flush(
      response({ status: 'unknown', error: 'CouchDB check failed unexpectedly', recordedAt: new Date().toISOString() }),
    );
    fixture.detectChanges();

    const badge = element.querySelector<HTMLElement>('.badge');
    expect(badge?.textContent).toBe('unknown');
    expect(badge?.dataset['status']).toBe('unknown');
    expect(element.querySelector('.problem')?.textContent).toContain('failed unexpectedly');
  });

  it('renders a timeline strip from the history', () => {
    const now = Date.now();
    http.expectOne(URL).flush({
      current: snapshot({ recordedAt: new Date(now - 10_000).toISOString() }),
      history: [
        snapshot({ recordedAt: new Date(now - 10_000).toISOString() }),
        snapshot({ status: 'unhealthy', reachable: false, recordedAt: new Date(now - 20_000).toISOString() }),
      ],
    } satisfies CouchdbResponse);
    fixture.detectChanges();

    const segments = element.querySelectorAll<HTMLElement>('.strip .segment');
    expect(Array.from(segments, (s) => s.dataset['status'])).toEqual(['unhealthy', 'healthy']);
    expect(segments[0].style.width).toBe('50%');
    expect(element.querySelector('.strip')?.getAttribute('aria-label')).toBe('CouchDB history');
  });

  it('refreshes on the interval and reflects the new state', () => {
    http.expectOne(URL).flush(response(snapshot()));
    fixture.detectChanges();
    expect(element.querySelector('.badge')?.textContent).toBe('reachable');

    vi.advanceTimersByTime(1000);
    http.expectOne(URL).flush(response(snapshot({ status: 'unhealthy', reachable: false })));
    fixture.detectChanges();
    expect(element.querySelector('.badge')?.textContent).toBe('unreachable');
  });

  it('keeps the last data and shows an error when a refresh fails', () => {
    http.expectOne(URL).flush(response(snapshot()));
    vi.advanceTimersByTime(1000);
    http.expectOne(URL).flush({ error: 'CouchDB status unavailable' }, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();

    expect(element.querySelector('.error')?.textContent).toContain('retrying');
    expect(element.querySelector('.badge')?.textContent).toBe('reachable');

    vi.advanceTimersByTime(1000);
    http.expectOne(URL).flush(response(snapshot()));
    fixture.detectChanges();
    expect(element.querySelector('.error')).toBeNull();
  });

  it('says so when no history has been recorded yet', () => {
    http.expectOne(URL).flush({ current: null, history: [] } satisfies CouchdbResponse);
    fixture.detectChanges();

    expect(element.querySelector('.empty')?.textContent).toContain('No CouchDB status recorded yet');
    expect(element.querySelector('.badge')).toBeNull();
    expect(element.querySelectorAll('.strip .segment')).toHaveLength(0);
  });
});
