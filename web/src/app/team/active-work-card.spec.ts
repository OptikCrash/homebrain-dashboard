import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActiveWorkCard } from './active-work-card';
import { ActivePhase, ActiveWork, RecentWork, TeamStatusResponse } from './team-status';

const URL = '/api/team/status';
const NOW = new Date('2026-10-22T18:30:00Z');

function minutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString();
}

function work(overrides: Partial<ActiveWork> = {}): ActiveWork {
  return {
    instance: 'issue-6-sabine',
    name: 'Sabine',
    title: 'frontend',
    engine: 'claude',
    kind: 'build',
    issue: 6,
    pr: null,
    branch: 'issue-6-sabine',
    phase: 'building',
    started_at: minutesAgo(12),
    updated_at: minutesAgo(1),
    result: '',
    ...overrides,
  };
}

function recent(overrides: Partial<RecentWork> = {}): RecentWork {
  return {
    name: 'Bruno',
    title: 'backend',
    issue: 5,
    pr: 9,
    phase: 'done',
    result: 'PR opened',
    updated_at: minutesAgo(12),
    ...overrides,
  };
}

function response(overrides: Partial<TeamStatusResponse> = {}): TeamStatusResponse {
  return { roster: [], active: [], recent: [], ...overrides };
}

describe('ActiveWorkCard', () => {
  let fixture: ComponentFixture<ActiveWorkCard>;
  let http: HttpTestingController;
  let element: HTMLElement;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    await TestBed.configureTestingModule({
      imports: [ActiveWorkCard],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ActiveWorkCard);
    fixture.componentRef.setInput('refreshMs', 1000);
    element = fixture.nativeElement;
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    http.verify();
    vi.useRealTimers();
  });

  function stepStates(): Record<string, string | undefined> {
    const steps = element.querySelectorAll<HTMLElement>('.stepper .step');
    return Object.fromEntries(Array.from(steps, (s) => [s.firstChild?.textContent?.trim(), s.dataset['state']]));
  }

  it('shows a loading state before the first response', () => {
    expect(element.querySelector('.empty')?.textContent).toContain('Loading');
    http.expectOne(URL).flush(response());
  });

  it('says so when nobody is working and nothing has finished', () => {
    http.expectOne(URL).flush(response());
    fixture.detectChanges();

    const empty = Array.from(element.querySelectorAll('.empty'), (e) => e.textContent);
    expect(empty).toEqual([expect.stringContaining('Nobody is working'), expect.stringContaining('No finished work')]);
    expect(element.querySelector('.job')).toBeNull();
  });

  it('shows who is on what, the branch and how long', () => {
    http.expectOne(URL).flush(response({ active: [work({ pr: 13 })] }));
    fixture.detectChanges();

    const job = element.querySelector('.job')!;
    expect(job.querySelector('.name')?.textContent).toBe('Sabine');
    expect(job.querySelector('.target')?.textContent).toBe('issue #6 · PR #13');
    expect(job.querySelector('.branch')?.textContent).toBe('issue-6-sabine');
    expect(job.querySelector('.elapsed')?.textContent).toBe('for 12m');
  });

  it('labels a review job by its PR', () => {
    http.expectOne(URL).flush(response({ active: [work({ kind: 'review', issue: null, pr: 13, phase: 'reviewing' })] }));
    fixture.detectChanges();

    expect(element.querySelector('.job .target')?.textContent).toBe('review of PR #13');
  });

  const expected: Record<ActivePhase, Record<string, string>> = {
    starting: { starting: 'current', building: 'pending', pushing: 'pending', reviewing: 'pending' },
    building: { starting: 'complete', building: 'current', pushing: 'pending', reviewing: 'pending' },
    pushing: { starting: 'complete', building: 'complete', pushing: 'current', reviewing: 'pending' },
    reviewing: { starting: 'complete', building: 'complete', pushing: 'complete', reviewing: 'current' },
  };

  for (const [phase, states] of Object.entries(expected)) {
    it(`highlights ${phase} as the current step`, () => {
      http.expectOne(URL).flush(response({ active: [work({ phase: phase as ActivePhase })] }));
      fixture.detectChanges();

      expect(stepStates()).toEqual(states);
      const current = element.querySelectorAll('[aria-current="step"]');
      expect(current).toHaveLength(1);
      expect(current[0].textContent).toContain(phase);
      expect(element.querySelector('.outcome')).toBeNull();
    });
  }

  it('shows a terminal latest instance with its outcome, and in Recent', () => {
    http.expectOne(URL).flush(
      response({
        active: [work({ phase: 'failed', result: 'tests failed', started_at: minutesAgo(30), updated_at: minutesAgo(5) })],
        recent: [recent({ name: 'Sabine', title: 'frontend', issue: 6, pr: null, phase: 'failed', result: 'tests failed', updated_at: minutesAgo(5) })],
      }),
    );
    fixture.detectChanges();

    const job = element.querySelector('.job')!;
    expect(job.querySelector('.stepper')).toBeNull();
    expect(job.querySelector('.badge')?.textContent).toBe('failed');
    expect(job.querySelector('.result')?.textContent).toBe('tests failed');
    expect(job.querySelector('.elapsed')?.textContent).toBe('took 25m');

    const item = element.querySelector('.recent-item')!;
    expect(item.querySelector('.name')?.textContent).toBe('Sabine');
    expect(item.querySelector('.target')?.textContent).toBe('issue #6');
    expect(item.querySelector('.result')?.textContent).toBe('tests failed');
    expect(item.querySelector('.when')?.textContent).toBe('failed 5m ago');
  });

  it('lists Recent in the order and length the API returns', () => {
    const items = [
      recent({ name: 'Bruno', updated_at: minutesAgo(12) }),
      recent({ name: 'Sabine', phase: 'no-changes', result: '', updated_at: minutesAgo(90) }),
      recent({ name: 'Gus', phase: 'stopped', updated_at: minutesAgo(60 * 26) }),
    ];
    http.expectOne(URL).flush(response({ recent: items }));
    fixture.detectChanges();

    const rows = element.querySelectorAll('.recent-item');
    expect(Array.from(rows, (r) => r.querySelector('.name')?.textContent)).toEqual(['Bruno', 'Sabine', 'Gus']);
    expect(Array.from(rows, (r) => r.querySelector('.when')?.textContent)).toEqual([
      'done 12m ago',
      'no-changes 1h 30m ago',
      'stopped 1d 2h ago',
    ]);
    expect(rows[0].querySelector('.target')?.textContent).toBe('issue #5 · PR #9');
  });

  it('refreshes on the interval and moves the stepper forward', () => {
    http.expectOne(URL).flush(response({ active: [work({ phase: 'building' })] }));
    fixture.detectChanges();
    expect(element.querySelector('[aria-current="step"]')?.textContent).toContain('building');

    vi.advanceTimersByTime(1000);
    http.expectOne(URL).flush(response({ active: [work({ phase: 'pushing' })] }));
    fixture.detectChanges();
    expect(element.querySelector('[aria-current="step"]')?.textContent).toContain('pushing');
  });

  it('keeps the last data and shows an error when a refresh fails', () => {
    http.expectOne(URL).flush(response({ active: [work()] }));
    vi.advanceTimersByTime(1000);
    http.expectOne(URL).flush({ error: 'Team status unavailable' }, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();

    expect(element.querySelector('.error')?.textContent).toContain('retrying');
    expect(element.querySelectorAll('.job')).toHaveLength(1);

    vi.advanceTimersByTime(1000);
    http.expectOne(URL).flush(response());
    fixture.detectChanges();
    expect(element.querySelector('.error')).toBeNull();
  });
});
