import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RosterCard } from './roster-card';
import { RosterMember, TeamStatusResponse } from './team-status';

const URL = '/api/team/status';

function member(overrides: Partial<RosterMember> = {}): RosterMember {
  return { name: 'Sabine', title: 'frontend', engine: 'claude', status: 'idle', ...overrides };
}

function response(...roster: RosterMember[]): TeamStatusResponse {
  return { roster, active: [], recent: [] };
}

describe('RosterCard', () => {
  let fixture: ComponentFixture<RosterCard>;
  let http: HttpTestingController;
  let element: HTMLElement;

  beforeEach(async () => {
    vi.useFakeTimers();
    await TestBed.configureTestingModule({
      imports: [RosterCard],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(RosterCard);
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
    http.expectOne(URL).flush(response());
  });

  it('shows every teammate with their title, idle or active', () => {
    http.expectOne(URL).flush(
      response(
        member({ name: 'Sabine', title: 'frontend', status: 'active' }),
        member({ name: 'Bruno', title: 'backend' }),
        member({ name: 'Rita', title: 'reviewer', engine: 'auto' }),
      ),
    );
    fixture.detectChanges();

    const members = element.querySelectorAll('.member');
    expect(Array.from(members, (m) => m.querySelector('.name')?.textContent)).toEqual(['Sabine', 'Bruno', 'Rita']);
    expect(Array.from(members, (m) => m.querySelector('.title')?.textContent)).toEqual(['frontend', 'backend', 'reviewer']);
    const badges = Array.from(members, (m) => m.querySelector<HTMLElement>('.badge')!);
    expect(badges.map((b) => b.textContent)).toEqual(['active', 'idle', 'idle']);
    expect(badges[0].dataset['status']).toBe('active');
  });

  it('shows an all-idle roster', () => {
    http.expectOne(URL).flush(response(member({ name: 'Sabine' }), member({ name: 'Gus', title: 'generalist' })));
    fixture.detectChanges();

    const badges = element.querySelectorAll('.member .badge');
    expect(Array.from(badges, (b) => b.textContent)).toEqual(['idle', 'idle']);
  });

  it('says so when the roster is empty', () => {
    http.expectOne(URL).flush(response());
    fixture.detectChanges();

    expect(element.querySelector('.empty')?.textContent).toContain('No teammates');
    expect(element.querySelector('.member')).toBeNull();
  });

  it('refreshes on the interval and reflects the new state', () => {
    http.expectOne(URL).flush(response(member()));
    fixture.detectChanges();
    expect(element.querySelector('.badge')?.textContent).toBe('idle');

    vi.advanceTimersByTime(1000);
    http.expectOne(URL).flush(response(member({ status: 'active' })));
    fixture.detectChanges();
    expect(element.querySelector('.badge')?.textContent).toBe('active');
  });

  it('keeps the last data and shows an error when a refresh fails', () => {
    http.expectOne(URL).flush(response(member()));
    vi.advanceTimersByTime(1000);
    http.expectOne(URL).flush({ error: 'Team status unavailable' }, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();

    expect(element.querySelector('.error')?.textContent).toContain('retrying');
    expect(element.querySelectorAll('.member')).toHaveLength(1);

    vi.advanceTimersByTime(1000);
    http.expectOne(URL).flush(response(member()));
    fixture.detectChanges();
    expect(element.querySelector('.error')).toBeNull();
  });
});
