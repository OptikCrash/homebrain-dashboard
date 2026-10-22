import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SyncthingCard } from './syncthing-card';
import { SyncthingFolder, SyncthingResponse, SyncthingSnapshot } from './syncthing-status';

const URL = '/api/status/syncthing';

function folder(overrides: Partial<SyncthingFolder> = {}): SyncthingFolder {
  return { id: 'notes', state: 'idle', errors: 0, needItems: 0, needBytes: 0, ...overrides };
}

function snapshot(overrides: Partial<SyncthingSnapshot> = {}): SyncthingSnapshot {
  return {
    status: 'healthy',
    reachable: true,
    folders: [folder()],
    connections: { 'DEVICE-A': { connected: true }, 'DEVICE-B': { connected: false } },
    recordedAt: new Date(Date.now() - 60_000).toISOString(),
    ...overrides,
  };
}

function response(current: SyncthingSnapshot): SyncthingResponse {
  return { current, history: [current] };
}

describe('SyncthingCard', () => {
  let fixture: ComponentFixture<SyncthingCard>;
  let http: HttpTestingController;
  let element: HTMLElement;

  beforeEach(async () => {
    vi.useFakeTimers();
    await TestBed.configureTestingModule({
      imports: [SyncthingCard],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(SyncthingCard);
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
    expect(element.querySelector('.empty')?.textContent).toContain('Loading');
    http.expectOne(URL).flush(response(snapshot()));
  });

  it('shows a healthy, reachable Syncthing with its folders and devices', () => {
    http.expectOne(URL).flush(response(snapshot({ folders: [folder({ id: 'notes' }), folder({ id: 'photos' })] })));
    fixture.detectChanges();

    const badge = element.querySelector<HTMLElement>('.badge');
    expect(badge?.textContent).toBe('reachable');
    expect(badge?.dataset['status']).toBe('healthy');
    expect(element.querySelector('.devices')?.textContent).toContain('1 of 2 devices connected');

    const folders = element.querySelectorAll('.folder');
    expect(Array.from(folders, (f) => f.querySelector('.folder-id')?.textContent)).toEqual(['notes', 'photos']);
    expect(folders[0].querySelector('.badge')?.textContent).toBe('idle');
    expect(element.querySelector('.problem')).toBeNull();
  });

  it('surfaces folder errors and out-of-sync items as visible text', () => {
    http.expectOne(URL).flush(
      response(
        snapshot({
          status: 'unhealthy',
          folders: [
            folder({ id: 'notes', state: 'syncing', needItems: 3, needBytes: 2048 }),
            folder({ id: 'photos', state: 'error', errors: 2 }),
            folder({ id: 'music' }),
          ],
          error: 'Syncthing db/status request failed',
        }),
      ),
    );
    fixture.detectChanges();

    expect(element.querySelector<HTMLElement>('.badge')?.dataset['status']).toBe('unhealthy');
    expect(element.querySelector('.problem')?.textContent).toContain('Check error: Syncthing db/status request failed');

    const folders = element.querySelectorAll('.folder');
    expect(folders[0].querySelector('.badge')?.textContent).toBe('syncing');
    expect(folders[0].querySelector<HTMLElement>('.badge')?.dataset['status']).toBe('unhealthy');
    expect(folders[0].querySelector('.problem')?.textContent).toBe('Out of sync: 3 items (2.0 KB)');
    expect(folders[1].querySelector('.problem')?.textContent).toBe('2 errors');
    expect(folders[2].querySelector('.problem')).toBeNull();
    expect(folders[2].querySelector<HTMLElement>('.badge')?.dataset['status']).toBe('healthy');
  });

  it('shows Syncthing as unreachable with the check error', () => {
    http.expectOne(URL).flush(
      response({
        status: 'unhealthy',
        reachable: false,
        folders: [],
        error: 'Syncthing system/status request failed',
        recordedAt: new Date().toISOString(),
      }),
    );
    fixture.detectChanges();

    expect(element.querySelector('.badge')?.textContent).toBe('unreachable');
    expect(element.querySelector('.problem')?.textContent).toContain('system/status request failed');
    expect(element.querySelector('.folders')).toBeNull();
    expect(element.querySelector('.empty')).toBeNull();
  });

  it('shows unknown reachability when the check itself failed', () => {
    http.expectOne(URL).flush(
      response({ status: 'unknown', error: 'Syncthing check failed unexpectedly', recordedAt: new Date().toISOString() }),
    );
    fixture.detectChanges();

    const badge = element.querySelector<HTMLElement>('.badge');
    expect(badge?.textContent).toBe('unknown');
    expect(badge?.dataset['status']).toBe('unknown');
    expect(element.querySelector('.devices')).toBeNull();
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
    } satisfies SyncthingResponse);
    fixture.detectChanges();

    const segments = element.querySelectorAll<HTMLElement>('.strip .segment');
    expect(Array.from(segments, (s) => s.dataset['status'])).toEqual(['unhealthy', 'healthy']);
    expect(segments[0].style.width).toBe('50%');
    expect(element.querySelector('.strip')?.getAttribute('aria-label')).toBe('Syncthing history');
  });

  it('refreshes on the interval and reflects the new state', () => {
    http.expectOne(URL).flush(response(snapshot()));
    fixture.detectChanges();
    expect(element.querySelector('.badge')?.textContent).toBe('reachable');

    vi.advanceTimersByTime(1000);
    http.expectOne(URL).flush(response(snapshot({ status: 'unhealthy', reachable: false, folders: [] })));
    fixture.detectChanges();
    expect(element.querySelector('.badge')?.textContent).toBe('unreachable');
  });

  it('keeps the last data and shows an error when a refresh fails', () => {
    http.expectOne(URL).flush(response(snapshot()));
    vi.advanceTimersByTime(1000);
    http.expectOne(URL).flush({ error: 'Syncthing status unavailable' }, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();

    expect(element.querySelector('.error')?.textContent).toContain('retrying');
    expect(element.querySelectorAll('.folder')).toHaveLength(1);

    vi.advanceTimersByTime(1000);
    http.expectOne(URL).flush(response(snapshot()));
    fixture.detectChanges();
    expect(element.querySelector('.error')).toBeNull();
  });

  it('says so when no history has been recorded yet', () => {
    http.expectOne(URL).flush({ current: null, history: [] } satisfies SyncthingResponse);
    fixture.detectChanges();

    expect(element.querySelector('.empty')?.textContent).toContain('No Syncthing status recorded yet');
    expect(element.querySelector('.badge')).toBeNull();
    expect(element.querySelectorAll('.strip .segment')).toHaveLength(0);
  });
});
