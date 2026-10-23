import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BackupsCard } from './backups-card';
import { BackupHistoryRun, BackupRun, BackupsResponse, CurrentBackup } from './backups-status';

const URL = '/api/status/backups';

const GB = 1024 ** 3;

function run(overrides: Partial<BackupRun> = {}): BackupRun {
  return {
    state: 'ok',
    started_at: '2026-10-23T03:00:00.000Z',
    finished_at: '2026-10-23T03:12:30.000Z',
    last_success: '2026-10-23T03:12:30.000Z',
    error: null,
    snapshot_id: 'a1b2c3d4',
    files_total: 48213,
    bytes_total: 512 * GB,
    bytes_added: 2.1 * GB,
    duration_s: 750,
    ...overrides,
  };
}

function current(overrides: Partial<CurrentBackup> = {}): CurrentBackup {
  return { ...run(), previous: null, stale: false, ...overrides };
}

function historyRun(overrides: Partial<BackupHistoryRun> = {}): BackupHistoryRun {
  return { ...run(), previous: null, ...overrides } as BackupHistoryRun;
}

describe('BackupsCard', () => {
  let fixture: ComponentFixture<BackupsCard>;
  let http: HttpTestingController;
  let element: HTMLElement;

  const field = (name: string) => element.querySelector<HTMLElement>(`[data-field="${name}"]`);
  const text = (name: string) => field(name)?.textContent?.replace(/\s+/g, ' ').trim();
  const value = (name: string) => field(name)?.querySelector('dd')?.textContent?.trim();

  function flush(body: BackupsResponse) {
    http.expectOne(URL).flush(body);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    await TestBed.configureTestingModule({
      imports: [BackupsCard],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(BackupsCard);
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
    expect(element.querySelector('h2')?.textContent).toContain('Backups');
    expect(element.querySelector('.empty')?.textContent).toContain('Loading');
    flush({ current: null, history: [] });
  });

  it('shows "No backup yet" when there is no status file and no history', () => {
    flush({ current: null, history: [] });

    expect(element.querySelector('.empty')?.textContent).toContain('No backup yet');
    expect(field('state')).toBeNull();
    expect(element.querySelector('.history')).toBeNull();
  });

  it('shows a progress indicator and the previous run while running', () => {
    flush({
      current: current({
        state: 'running',
        started_at: '2026-10-23T03:00:00.000Z',
        finished_at: null,
        last_success: '2026-10-22T03:10:00.000Z',
        snapshot_id: null, files_total: null, bytes_total: null, bytes_added: null, duration_s: null,
        previous: run({ finished_at: '2026-10-22T03:10:00.000Z', bytes_added: 2.1 * GB }),
      }),
      history: [],
    });

    expect(field('state')?.textContent).toBe('running');
    expect(field('state')?.dataset['status']).toBe('running');
    const progress = element.querySelector('progress');
    expect(progress?.getAttribute('aria-label')).toBe('Backup in progress');
    // No percentage is reported, so the bar is indeterminate rather than faked.
    expect(progress?.hasAttribute('value')).toBe(false);
    expect(text('started')).toBe('Started 2026-10-23 03:00 UTC');
    expect(text('previous')).toBe('Last run: ok 2.1 GB added · finished 2026-10-22 03:10 UTC');
    expect(field('previous')?.querySelector('.badge')?.getAttribute('data-status')).toBe('healthy');
    // Completed-run details aren't shown for a run still in progress.
    expect(element.querySelector('dl')).toBeNull();
  });

  it('says so when a running backup has no previous run', () => {
    flush({ current: current({ state: 'running', finished_at: null, last_success: null, previous: null }), history: [] });

    expect(text('previous')).toBe('No previous run recorded.');
    expect(text('last-success')).toBe('Last success: none recorded');
  });

  it('shows a successful run with its details', () => {
    flush({ current: current(), history: [] });

    expect(field('state')?.textContent).toBe('ok');
    expect(field('state')?.dataset['status']).toBe('healthy');
    expect(element.querySelector('progress')).toBeNull();
    expect(value('finished')).toBe('2026-10-23 03:12 UTC');
    expect(value('added')).toBe('2.1 GB');
    expect(value('files')).toBe('48213');
    expect(value('duration')).toBe('12m 30s');
    expect(value('snapshot')).toBe('a1b2c3d4');
    expect(text('last-success')).toBe('Last success: 2026-10-23 03:12 UTC');
    expect(element.querySelector('.stale-badge')).toBeNull();
    expect(element.querySelector('.problem')).toBeNull();
    expect(element.querySelector('.error')).toBeNull();
  });

  it('shows a failed run and its error', () => {
    flush({
      current: current({
        state: 'failed', error: 'repository is locked', last_success: '2026-10-22T03:10:00.000Z',
        snapshot_id: null, bytes_added: null, files_total: null,
      }),
      history: [],
    });

    expect(field('state')?.textContent).toBe('failed');
    expect(field('state')?.dataset['status']).toBe('unhealthy');
    expect(text('failure')).toBe('Backup failed: repository is locked');
    expect(field('added')).toBeNull();
    expect(field('snapshot')).toBeNull();
    expect(text('last-success')).toBe('Last success: 2026-10-22 03:10 UTC');
  });

  it('shows a skipped run as the USB drive being missing', () => {
    flush({ current: current({ state: 'skipped', snapshot_id: null, bytes_added: null, duration_s: null }), history: [] });

    expect(field('state')?.textContent).toBe('skipped');
    expect(field('state')?.dataset['status']).toBe('warning');
    expect(text('failure')).toContain('USB backup drive');
  });

  it('flags a last success older than 26 hours', () => {
    flush({
      current: current({ state: 'skipped', last_success: '2026-10-21T03:10:00.000Z', stale: true }),
      history: [],
    });

    expect(element.querySelector('.current')?.classList).toContain('stale');
    expect(element.querySelector('.stale-badge')?.textContent).toBe('overdue');
    expect(text('last-success')).toBe('Last success: 2026-10-21 03:10 UTC overdue');
    expect(text('stale')).toContain('No successful backup in over 26 hours');
  });

  it('renders the recent-run history, newest first', () => {
    flush({
      current: current(),
      history: [
        historyRun({ finished_at: '2026-10-23T03:12:30.000Z', bytes_added: 2.1 * GB }),
        historyRun({ state: 'failed', finished_at: '2026-10-22T03:05:00.000Z', bytes_added: null }),
        historyRun({ state: 'skipped', finished_at: '2026-10-21T03:00:05.000Z', bytes_added: null }),
      ],
    });

    const rows = Array.from(element.querySelectorAll<HTMLElement>('.history .run'));
    expect(element.querySelector('.history')?.getAttribute('aria-label')).toBe('Recent runs');
    expect(rows.map((r) => [...r.children].map((cell) => cell.textContent?.trim()))).toEqual([
      ['ok', '2026-10-23 03:12 UTC', '2.1 GB added'],
      ['failed', '2026-10-22 03:05 UTC', '—'],
      ['skipped', '2026-10-21 03:00 UTC', '—'],
    ]);
    expect(rows.map((r) => r.querySelector('.badge')?.getAttribute('data-status'))).toEqual(['healthy', 'unhealthy', 'warning']);
    expect(rows[0].querySelector('time')?.getAttribute('datetime')).toBe('2026-10-23T03:12:30.000Z');
  });

  it('still shows history when the status file is currently missing', () => {
    flush({ current: null, history: [historyRun()] });

    expect(element.querySelector('.empty')?.textContent).toContain('No backup status file right now');
    expect(element.querySelector('.empty')?.textContent).not.toContain('No backup yet');
    expect(element.querySelectorAll('.history .run').length).toBe(1);
  });

  it('refreshes on the interval and reflects the new state', () => {
    flush({ current: current({ state: 'running', finished_at: null }), history: [] });
    expect(field('state')?.textContent).toBe('running');

    vi.advanceTimersByTime(1000);
    flush({ current: current(), history: [historyRun()] });
    expect(field('state')?.textContent).toBe('ok');
    expect(element.querySelector('progress')).toBeNull();
  });

  it('keeps the last data and shows an error when a refresh fails', () => {
    flush({ current: current(), history: [] });
    vi.advanceTimersByTime(1000);
    http.expectOne(URL).flush({ error: 'Backup status unavailable' }, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();

    expect(element.querySelector('.error')?.textContent).toContain('retrying');
    expect(field('state')?.textContent).toBe('ok');

    vi.advanceTimersByTime(1000);
    flush({ current: current(), history: [] });
    expect(element.querySelector('.error')).toBeNull();
  });

  it('shows only the error when the first request fails', () => {
    http.expectOne(URL).flush({ error: 'Backup status unavailable' }, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();

    expect(element.querySelector('.error')?.getAttribute('role')).toBe('alert');
    expect(element.querySelector('.empty')).toBeNull();
    expect(field('state')).toBeNull();
  });
});
